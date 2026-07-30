//! Real logic behind the [`crate::rpc`] contract types; `quire-sidecar` is a thin JSON-RPC dispatcher over these (D6), so a future `quire-ffi` can reuse them with a different transport.
//!
//! No `cancel_compile` here: `quire-sidecar` is one process per compile with no in-process handle to interrupt -- the caller kills the OS process instead, a transport-layer concern.
//!
//! `complete` *is* here as of 3.1 -- real for `\ref`/`\eqref`/`\autoref`/`\cite`/bare-command
//! (macro) completion, `quire-core`'s own index rather than texlab (GPL-3.0, D7).
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

/// `project::resolve_within` already confines every reference the graph walk follows to the
/// project directory, so `real_path` should always be inside `project_dir` by the time it gets
/// here. This is the last line of defense, not the primary control: `strip_prefix` failing (an
/// absolute `real_path` outside `project_dir`) or succeeding but leaving `..` components in
/// `relative` (both would otherwise let `shadow_dir.join(relative)` land outside `shadow_dir`)
/// are treated as a bug to refuse, never silently followed to wherever they'd resolve.
fn write_into_shadow(
    project_dir: &Path,
    shadow_dir: &Path,
    real_path: &Path,
    content: &[u8],
) -> Result<(), CompileError> {
    let relative = real_path.strip_prefix(project_dir).map_err(|_| CompileError {
        message: format!("refusing to mirror {}: outside the project directory", real_path.display()),
        log: None,
    })?;
    if relative.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(CompileError {
            message: format!("refusing to mirror {}: escapes the project directory", real_path.display()),
            log: None,
        });
    }
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

/// Real per task 3.1: section structure (`\part`..`\subsubsection`) plus `\label` sites, both
/// built from the same pass over `req.uri`'s content ([`crate::index`]). Reads from disk like
/// every handler in this file -- `OutlineRequest` carries no dirty-buffer text, so this reflects
/// the last saved content, not unsaved editor state.
pub fn outline(req: &OutlineRequest) -> Vec<OutlineNode> {
    let project_dir = Path::new(&req.project_id);
    let Some(root) = project::detect_root(project_dir).root else {
        return Vec::new();
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);
    index.outline_for(Path::new(&req.uri))
}

/// Real per tasks 3.1 (`\ref`/`\eqref`/`\autoref` label completion), 3.2 (`\cite{` citation
/// completion), 3.3 (bare-command macro completion), 3.4 (`\input`/`\include`/
/// `\includegraphics` file-path completion), and 3.5 (bare-command CTAN package completion,
/// merged into the same response as 3.3's macros) -- every other trigger context (math symbols,
/// snippets) returns `[]` until 3.7/3.8 land their own extraction sources onto the same
/// [`crate::index::ProjectIndex`]. Checked before touching disk: no reason to rebuild the whole
/// project index for a keystroke inside an argument none of these triggers recognize.
pub fn complete(req: &CompletionRequest) -> Vec<CompletionItem> {
    let is_ref = crate::index::is_ref_completion_context(&req.text, &req.position);
    let is_cite = crate::index::is_cite_completion_context(&req.text, &req.position);
    let is_command = crate::index::is_command_completion_context(&req.text, &req.position);
    let is_input = crate::index::is_input_completion_context(&req.text, &req.position);
    let is_graphic = crate::index::is_includegraphics_completion_context(&req.text, &req.position);
    if !is_ref && !is_cite && !is_command && !is_input && !is_graphic {
        return Vec::new();
    }

    let project_dir = Path::new(&req.project_id);
    let Some(root) = project::detect_root(project_dir).root else {
        return Vec::new();
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);

    if is_ref {
        label_completions(&index)
    } else if is_cite {
        citation_completions(&index)
    } else if is_command {
        command_completions(&index)
    } else if is_input {
        path_completions(index.tex_paths())
    } else {
        path_completions(index.graphic_paths())
    }
}

// Section 9.4's ranking: project-local symbols outrank package commands, which outrank the
// (still unbuilt) global fallback. PACKAGE_PRIORITY only matters relative to PROJECT_LOCAL_PRIORITY
// within the same response -- command_completions is the one place both tiers appear together.
const PROJECT_LOCAL_PRIORITY: i32 = 0;
const PACKAGE_PRIORITY: i32 = 10;

fn label_completions(index: &crate::index::ProjectIndex) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = index
        .labels()
        .map(|l| CompletionItem {
            label: l.name.clone(),
            kind: CompletionKind::Label,
            insert: l.name.clone(),
            detail: None,
            documentation: None,
            symbol_preview: None,
            sort_priority: PROJECT_LOCAL_PRIORITY,
        })
        .collect();
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

fn citation_completions(index: &crate::index::ProjectIndex) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = index
        .citations()
        .map(|c| CompletionItem {
            label: c.key.clone(),
            kind: CompletionKind::Citation,
            insert: c.key.clone(),
            detail: c.detail.clone(),
            documentation: None,
            symbol_preview: None,
            sort_priority: PROJECT_LOCAL_PRIORITY,
        })
        .collect();
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// Shared by `\input`/`\include` and `\includegraphics` completion -- both just offer a
/// project-relative path, with the extension already filtered by which one `paths` came from.
/// The full path (extension included) is inserted rather than an idiomatic extension-less form:
/// unambiguous even if two candidates share a basename with different extensions (`plot.pdf` and
/// `plot.png`), and always valid LaTeX either way.
fn path_completions<'a>(paths: impl Iterator<Item = &'a str>) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = paths
        .map(|p| CompletionItem {
            label: p.to_string(),
            kind: CompletionKind::Path,
            insert: p.to_string(),
            detail: None,
            documentation: None,
            symbol_preview: None,
            sort_priority: PROJECT_LOCAL_PRIORITY,
        })
        .collect();
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// Bare-command completion (task 3.3's macros and 3.5's CTAN package commands, merged into one
/// response and ranked via `sort_priority`, per Section 9.4). `label`/`insert` deliberately omit
/// the leading backslash -- the client's bare-command trigger (`Editor.tsx`'s `wordMatch`)
/// replaces starting right after the backslash already in the document, matching how label/
/// citation completions already replace starting after `{`.
fn command_completions(index: &crate::index::ProjectIndex) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = index
        .macros()
        .map(|m| CompletionItem {
            label: m.name.clone(),
            kind: CompletionKind::Macro,
            insert: insert_with_tabstops(&m.name, m.arity),
            // The raw substitution body, not a description -- there's nothing else to show, and
            // seeing what a macro actually expands to is exactly what "readable" means here too.
            detail: if m.body.is_empty() { None } else { Some(m.body.clone()) },
            documentation: None,
            symbol_preview: None,
            sort_priority: PROJECT_LOCAL_PRIORITY,
        })
        .collect();

    let packages: Vec<&str> = index.packages().collect();
    items.extend(crate::index::ctan::commands_for_packages(packages.into_iter()).into_iter().map(|c| CompletionItem {
        label: c.name.clone(),
        kind: CompletionKind::Command,
        insert: insert_with_tabstops(&c.name, c.arity),
        detail: c.detail,
        documentation: None,
        symbol_preview: None,
        sort_priority: PACKAGE_PRIORITY,
    }));

    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// Arity -> tabstops, shared by macro (3.3) and CTAN package command (3.5) completions: `\vect`
/// (arity 1) becomes `vect{${1:arg1}}` (no leading backslash -- see `command_completions`'s
/// comment), `\greet` (arity 2) becomes `greet{${1:arg1}}{${2:arg2}}`, and arity 0 is just the
/// bare name with no braces at all -- both extraction sources already treat "doesn't cleanly
/// take N required brace arguments" as arity 0 rather than guess. `${N:argN}` rather than empty
/// `${N}` fields since neither a macro definition nor `data/ctan-commands.json` names its own
/// arguments.
fn insert_with_tabstops(name: &str, arity: u32) -> String {
    let mut s = name.to_string();
    for n in 1..=arity {
        s.push('{');
        s.push_str(&format!("${{{n}:arg{n}}}"));
        s.push('}');
    }
    s
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_with_tabstops_produces_one_brace_group_per_arity() {
        assert_eq!(insert_with_tabstops("greeting", 0), "greeting", "arity 0 must not add any braces at all");
        assert_eq!(insert_with_tabstops("vect", 1), "vect{${1:arg1}}");
        assert_eq!(insert_with_tabstops("greet", 2), "greet{${1:arg1}}{${2:arg2}}", "each argument gets its own brace group, in order");
    }

    #[test]
    fn package_commands_rank_below_project_local_priority() {
        let items = crate::index::ctan::commands_for_packages(["tikz"].into_iter());
        assert!(!items.is_empty(), "sanity check: tikz should have commands in the bundled database");
        assert!(PACKAGE_PRIORITY > PROJECT_LOCAL_PRIORITY, "Section 9.4: package commands must rank below project-local symbols");
    }
}
