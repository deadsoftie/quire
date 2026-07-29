//! Real logic behind the [`crate::rpc`] contract types; `quire-sidecar` is a thin JSON-RPC dispatcher over these (D6), so a future `quire-ffi` can reuse them with a different transport.
//!
//! No `cancel_compile` here: `quire-sidecar` is one process per compile with no in-process handle to interrupt -- the caller kills the OS process instead, a transport-layer concern.
//!
//! No `complete` here either: it's still texlab (GPL-3.0, D7), kept out of this binary since it will eventually ship on iOS.
//!
//! `quire-core` holds no project registry -- `ProjectId` is the project's root directory path itself, and every function re-derives what it needs from that.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, fs};

use tectonic_bundles::Bundle;

use crate::project::{self, FileKind};
use crate::rerun::compile_latex_in_dir;
use crate::rpc::*;
use crate::CompileError;

pub fn open_project(req: &OpenProjectRequest) -> Result<OpenProjectResponse, CompileError> {
    let project_dir = Path::new(&req.path);
    let detection = project::detect_root(project_dir);

    // `root: DocUri` isn't optional, so an ambiguous result still needs a best guess -- the first sorted candidate; `candidates` carries the full list for the UI to prompt with.
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
        // The project's root *directory*, not the detected root *document* (that's `root` below).
        project_id: req.path.clone(),
        root: root.display().to_string(),
        root_confidence: detection.confidence.into(),
        candidates: detection.candidates.iter().map(|p| p.display().to_string()).collect(),
        files,
        // Tectonic is embedded (D1), so an engine always exists; per-compile network/package issues surface through compile()'s own errors instead.
        engine_available: true,
    })
}

/// No server-side state to update -- just validates `uri` so the caller can trust what it's about to remember.
pub fn set_root(req: &SetRootRequest) -> Result<(), CompileError> {
    if !Path::new(&req.uri).is_file() {
        return Err(CompileError {
            message: format!("{} is not a file", req.uri),
            log: None,
        });
    }
    Ok(())
}

/// No-op -- no server-side resource is tied to a project to release.
pub fn close_project(_req: &CloseProjectRequest) -> Result<(), CompileError> {
    Ok(())
}

/// Mirrors only the files reachable from the root (per [`crate::project::FileGraph`]) into the shadow dir; dirty buffers override on-disk content, everything else is read fresh. A LaTeX failure is a normal `status: "errors"` result, never an `Err` -- `Err` is reserved for the request itself being unserviceable.
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

    // Graphics never come from dirty buffers -- copy the real bytes across.
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
            // No log-parsing/translation yet (M3.10) -- the real error, as-is.
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

/// M3 scaffolding; always empty until the completion index (Section 9.4) exists.
pub fn outline(_req: &OutlineRequest) -> Vec<OutlineNode> {
    Vec::new()
}

/// M4 scaffolding; always reports nothing fetched, nothing failed -- honest about doing no work.
pub fn prefetch_packages(_req: &PrefetchPackagesRequest) -> PrefetchPackagesResponse {
    PrefetchPackagesResponse { fetched: Vec::new(), failed: Vec::new() }
}

/// `version` is real; `offlinePackages`/`cacheBytes` are always `0` -- both are M4 concepts that don't exist yet.
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
