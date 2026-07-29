//! Real logic behind the [`crate::rpc`] contract types (task 1.8).
//!
//! `quire-sidecar` is a thin JSON-RPC dispatcher over these functions --
//! per D6 ("Core logic: Rust, one crate, two transports"), the actual work
//! lives here so a future `quire-ffi` (M5, Capacitor) can call the exact
//! same functions with a different transport wrapped around them.
//!
//! **No `cancel_compile` here, deliberately.** There's nothing at this
//! layer to cancel: `quire-sidecar` is one process per compile (1.4's
//! decision) that reads one request, blocks synchronously inside Tectonic,
//! and writes one response -- there's no second channel to send a "cancel"
//! message down while that's happening, and no in-process compile handle
//! to interrupt even if there were (Tectonic exposes none, also 1.4).
//! Cancellation is real today because the *caller* kills the OS process;
//! that's a transport-layer concern (`packages/client`), not something
//! `quire-core` can implement a function for.
//!
//! **No `complete` here either.** Completion is still texlab (D7's M0/M1
//! scaffolding, GPL-3.0, spawned directly from JS) -- routing it through
//! `quire-sidecar`/Rust would mean linking GPL-3.0 code into the same
//! binary that will eventually ship on iOS, exactly what D7 exists to
//! prevent. `packages/client`'s desktop transport talks to texlab
//! directly, same as `apps/desktop/src/completion.js` already did.
//!
//! **Statelessness, and what `ProjectId` actually is:** `quire-core` holds
//! no project registry -- every call here is self-contained, because nothing
//! could persist server-side state across calls anyway (fresh process per
//! request). So `ProjectId` *is* the project's root directory's absolute
//! path, not an opaque handle into some session table; every function below
//! that needs "the project" just re-derives what it needs (re-running
//! [`crate::project::detect_root`] is cheap and deterministic) from that
//! path directly. The caller (`apps/desktop/src/main.js` today) is the one
//! long-lived process that actually needs to remember "which project is
//! open," and it already does.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, fs};

use tectonic_bundles::Bundle;

use crate::project::{self, FileKind};
use crate::rerun::compile_latex_in_dir;
use crate::rpc::*;
use crate::CompileError;

/// `req.path` doesn't have to already exist as a `.tex`-containing folder
/// for a valid `OpenProjectRequest` to error out at the type level -- this
/// is where that gets checked for real, so building a [`FileNode`] tree
/// out of it below (or [`detect_root`](project::detect_root) finding
/// nothing) fails with an honest message instead of a confusing one from
/// deeper in the pipeline.
pub fn open_project(req: &OpenProjectRequest) -> Result<OpenProjectResponse, CompileError> {
    let project_dir = Path::new(&req.path);
    let detection = project::detect_root(project_dir);

    // `root_confidence: "ambiguous"` still needs *some* `root` value (the
    // contract's `root: DocUri` isn't optional) -- best guess is the first
    // (sorted) candidate, same as a human skimming the list top-to-bottom
    // would likely try first. `candidates` still carries the full list so
    // the UI can prompt properly; this is just what compiles by default
    // until they do.
    let root = detection
        .root
        .clone()
        .or_else(|| detection.candidates.first().cloned())
        .ok_or_else(|| CompileError {
            message: "No .tex file found in the selected folder".to_string(),
            log: None,
        })?;

    let graph = project::build_file_graph(&root);
    let files = graph
        .files
        .iter()
        .map(|f| FileNode {
            uri: f.path.display().to_string(),
            name: f.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            kind: match f.kind {
                FileKind::Tex => FileNodeKind::Tex,
                FileKind::Graphic => FileNodeKind::Graphic,
            },
        })
        .collect();

    Ok(OpenProjectResponse {
        // The project's own root *directory* (not the detected root
        // *document* -- that's the `root` field below), so every later
        // call can rebuild everything it needs from this one string.
        project_id: req.path.clone(),
        root: root.display().to_string(),
        root_confidence: detection.confidence.into(),
        candidates: detection.candidates.iter().map(|p| p.display().to_string()).collect(),
        files,
        // Tectonic is embedded as a library (D1) -- it's always "available"
        // in the sense this field is meant to capture (is there an engine
        // to even try compiling with, as opposed to e.g. a broken system
        // TeX install for D2's fallback). Whether a *specific* compile can
        // actually reach the network for an uncached package is a
        // per-compile concern already surfaced through `compile`'s own
        // error handling, not something to predict here.
        engine_available: true,
    })
}

/// No server-side state to update (see the module docs) -- this only
/// validates that `uri` is real, so the caller can trust what it's about
/// to remember.
pub fn set_root(req: &SetRootRequest) -> Result<(), CompileError> {
    if !Path::new(&req.uri).is_file() {
        return Err(CompileError {
            message: format!("{} is not a file", req.uri),
            log: None,
        });
    }
    Ok(())
}

/// No-op -- there is no server-side resource tied to a project to release.
/// Exists so the interface is complete and callers don't need to special-
/// case "should I call this."
pub fn close_project(_req: &CloseProjectRequest) -> Result<(), CompileError> {
    Ok(())
}

/// Mirrors the project's real files into the shadow dir at
/// `<projectId>/.quire/build/`, using [`crate::project::FileGraph`] rather
/// than a blind whole-directory copy (M0's `mirrorProjectToShadow`) -- only
/// files actually reachable from the root via
/// `\input`/`\include`/`\includegraphics`/`\subfile` get mirrored. Dirty
/// buffers override the on-disk content for whichever file(s) they cover;
/// everything else is read fresh from the real project files, so external
/// edits (task 1.3) are picked up automatically on the next compile.
///
/// Never propagates a LaTeX compile failure as an `Err` -- a compile that
/// fails because the *document* has an error is a normal, structured
/// outcome (`status: "errors"`), not an exceptional one; `Err` here is
/// reserved for things that mean the request itself couldn't be serviced
/// (e.g. `projectId` doesn't point at a real, readable project).
pub fn compile(req: &CompileRequest) -> Result<CompileResponse, CompileError> {
    let start = Instant::now();
    let project_dir = PathBuf::from(&req.project_id);
    let shadow_dir = project_dir.join(".quire").join("build");

    let detection = project::detect_root(&project_dir);
    let root = detection.root.ok_or_else(|| CompileError {
        message: "project root is ambiguous or missing; call openProject/setRoot first".to_string(),
        log: None,
    })?;

    let dirty: HashMap<&str, &str> =
        req.dirty_buffers.iter().map(|b| (b.uri.as_str(), b.text.as_str())).collect();

    let graph = project::build_file_graph(&root);
    let mut root_source = None;

    for file in &graph.files {
        if file.kind != FileKind::Tex {
            continue; // graphics are copied as-is below, never dirty-buffer-overridden
        }

        let uri = file.path.display().to_string();
        let content = match dirty.get(uri.as_str()) {
            Some(text) => text.to_string(),
            None => fs::read_to_string(&file.path).unwrap_or_default(),
        };

        if file.path == root {
            root_source = Some(content.clone());
        }

        write_into_shadow(&project_dir, &shadow_dir, &file.path, content.as_bytes())?;
    }

    // Graphics never come from dirty buffers (the editor doesn't edit
    // them) -- copy the real bytes across so `\includegraphics` resolves
    // inside the shadow dir exactly like every other reference.
    for file in graph.files.iter().filter(|f| f.kind == FileKind::Graphic) {
        let bytes = fs::read(&file.path).unwrap_or_default();
        write_into_shadow(&project_dir, &shadow_dir, &file.path, &bytes)?;
    }

    let root_source = root_source.ok_or_else(|| CompileError {
        message: "root document is not part of its own file graph".to_string(),
        log: None,
    })?;

    let compile_id = generate_compile_id();
    let bundle_version = bundle_digest_hex().unwrap_or_default();

    let response = match compile_latex_in_dir(&root_source, &shadow_dir) {
        Ok(output) => CompileResponse {
            compile_id,
            status: CompileStatus::Ok,
            pdf_path: Some(shadow_dir.join("texput.pdf").display().to_string()),
            changed_pages: output.changed_pages,
            page_count: output.page_count,
            duration_ms: start.elapsed().as_millis() as u32,
            diagnostics: Vec::new(),
            missing_packages: Vec::new(),
            bundle_version,
        },
        Err(e) => CompileResponse {
            compile_id,
            status: CompileStatus::Errors,
            pdf_path: None,
            changed_pages: Vec::new(),
            page_count: 0,
            duration_ms: start.elapsed().as_millis() as u32,
            // No log-parsing/plain-English translation yet (M3.10, Section
            // 9.5) -- this is the real error, honestly surfaced through
            // the real Diagnostic shape rather than invented structure.
            diagnostics: vec![Diagnostic {
                uri: None,
                range: None,
                severity: Severity::Error,
                message: e.message.clone(),
                raw_message: e.log.unwrap_or(e.message),
                hint: None,
                code: None,
            }],
            missing_packages: Vec::new(),
            bundle_version,
        },
    };

    Ok(response)
}

fn write_into_shadow(
    project_dir: &Path,
    shadow_dir: &Path,
    real_path: &Path,
    content: &[u8],
) -> Result<(), CompileError> {
    let relative = real_path.strip_prefix(project_dir).unwrap_or(real_path);
    let target = shadow_dir.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, content)?;
    Ok(())
}

fn generate_compile_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{}", std::process::id(), nanos)
}

fn bundle_digest_hex() -> Result<String, CompileError> {
    let config = tectonic::config::PersistentConfig::open(false)?;
    let mut bundle = config.default_bundle(false)?;
    Ok(bundle.get_digest()?.to_string())
}

/// M3 scaffolding (Section 9.4's completion index hasn't been built yet --
/// see the crate-level `rpc` module docs). Always empty; the shape exists
/// so M2's UI can be written against it now.
pub fn outline(_req: &OutlineRequest) -> Vec<OutlineNode> {
    Vec::new()
}

/// M4 scaffolding (Section 9.6's package bundle/cache system hasn't been
/// built yet). Always reports nothing fetched, nothing failed -- honest
/// about doing no work, not a silent success.
pub fn prefetch_packages(_req: &PrefetchPackagesRequest) -> PrefetchPackagesResponse {
    PrefetchPackagesResponse { fetched: Vec::new(), failed: Vec::new() }
}

/// `version` is real (the same Tectonic bundle digest [`compile`] reports
/// as `bundleVersion`); `offlinePackages`/`cacheBytes` are always `0` --
/// both are M4 (Section 9.6) concepts (a curated, *tracked* set of
/// installed packages) that don't exist yet. Raw disk usage of Tectonic's
/// own cache directory isn't the same thing and would be misleading to
/// report in its place.
pub fn bundle_status() -> Result<BundleStatusResponse, CompileError> {
    Ok(BundleStatusResponse { version: bundle_digest_hex()?, offline_packages: 0, cache_bytes: 0 })
}

pub fn read_file(req: &ReadFileRequest) -> Result<String, CompileError> {
    Ok(fs::read_to_string(&req.uri)?)
}

pub fn write_file(req: &WriteFileRequest) -> Result<(), CompileError> {
    fs::write(&req.uri, &req.text)?;
    Ok(())
}
