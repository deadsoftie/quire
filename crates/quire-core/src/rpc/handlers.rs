//! No `cancel_compile` here: `quire-sidecar` is one process per compile with no in-process handle
//! to interrupt -- the caller kills the OS process instead, a transport-layer concern.
//!
//! `quire-core` holds no project registry -- `ProjectId` is the project's root directory path
//! itself, and every function re-derives what it needs from that.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, fs};

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
                FileKind::Bib => FileNodeKind::Bib,
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
        // Tectonic is embedded, so an engine always exists; per-compile network/package issues surface through compile()'s own errors instead.
        engine_available: true,
        bundle_version_notice: crate::bundle::record_version_pin(project_dir),
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

/// A LaTeX failure is a normal `status: "errors"` result, never an `Err` -- `Err` is reserved for
/// the request itself being unserviceable.
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
            continue; // non-Tex files (graphics, bib resources) are copied as-is below, never dirty-buffer-overridden
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

    // Non-Tex files (graphics, .bib resources) never come from dirty buffers -- copy the real
    // bytes across. BibTeX needs its .bib physically present in the shadow dir at the same
    // relative path the root document's \bibliography{...}/\addbibresource{...} names it by.
    for file in graph.files.iter().filter(|f| f.kind != FileKind::Tex) {
        let bytes = fs::read(&file.path).unwrap_or_default();
        write_into_shadow(&project_dir, &shadow_dir, &file.path, &bytes)?;
    }

    let root_source = root_source.ok_or_else(|| CompileError {
        message: "root document is not part of its own file graph".to_string(),
        log: None,
    })?;

    let compile_id = generate_compile_id();
    let bundle_version = crate::bundle::digest_hex().unwrap_or_default();

    let root_uri = root.display().to_string();

    let compile_result = match req.engine {
        CompileEngine::Tectonic => compile_latex_in_dir(&root_source, &shadow_dir),
        CompileEngine::System => {
            let root_relative = root.strip_prefix(&project_dir).unwrap_or(&root);
            match crate::system_tex::detect() {
                Some((engine, _version)) => crate::system_tex::compile(engine, root_relative, &shadow_dir),
                // Re-detected here rather than trusting the caller's earlier `detectSystemTex()`
                // call -- core holds no state (1.4), and the install may have vanished mid-session.
                None => {
                    return Ok(CompileResponse {
                        compile_id,
                        status: CompileStatus::EngineMissing,
                        pdf_path: None,
                        changed_pages: Vec::new(),
                        page_count: 0,
                        duration_ms: start.elapsed().as_millis() as u32,
                        diagnostics: vec![Diagnostic {
                            uri: None,
                            range: None,
                            severity: Severity::Error,
                            message: "No working system TeX installation was found.".to_string(),
                            raw_message: "No working system TeX installation was found.".to_string(),
                            hint: Some(
                                "Disable \"Use System TeX\" in Settings, or install/reinstall TeX Live or MiKTeX."
                                    .to_string(),
                            ),
                            code: None,
                        }],
                        missing_packages: Vec::new(),
                        bundle_version,
                    });
                }
            }
        }
    };

    let response = match compile_result {
        Ok(output) => CompileResponse {
            compile_id,
            status: CompileStatus::Ok,
            pdf_path: Some(shadow_dir.join("texput.pdf").display().to_string()),
            changed_pages: output.changed_pages,
            page_count: output.page_count,
            duration_ms: start.elapsed().as_millis() as u32,
            diagnostics: crate::diagnostics::translate_log(&output.log, &root_uri, &project_dir),
            missing_packages: Vec::new(),
            bundle_version,
        },
        Err(e) => {
            let missing_packages = e.log.as_deref().map(crate::diagnostics::missing_packages).unwrap_or_default();
            let translated = e
                .log
                .as_deref()
                .map(|log| crate::diagnostics::translate_log(log, &root_uri, &project_dir))
                .unwrap_or_default();
            // A log the translator recognized nothing in (or no log at all -- some engine-level
            // failures never produce one) still needs to reach the user as something, not silence.
            let diagnostics = if translated.is_empty() {
                vec![Diagnostic {
                    uri: None,
                    range: None,
                    severity: Severity::Error,
                    message: e.message.clone(),
                    raw_message: e.log.unwrap_or(e.message),
                    hint: None,
                    code: None,
                }]
            } else {
                translated
            };
            // A missing package takes priority over generic errors -- it's the one failure mode
            // with a real fix path (task 4.4's install-and-recompile flow), even if the same log
            // also has unrelated errors after the point compilation gave up.
            let status = if missing_packages.is_empty() { CompileStatus::Errors } else { CompileStatus::PackagesMissing };
            CompileResponse {
                compile_id,
                status,
                pdf_path: None,
                changed_pages: Vec::new(),
                page_count: 0,
                duration_ms: start.elapsed().as_millis() as u32,
                diagnostics,
                missing_packages,
                bundle_version,
            }
        }
    };

    Ok(response)
}

/// Last line of defense, not the primary control -- `resolve_within` already confines every
/// reference to `project_dir`, but a failing `strip_prefix` or a leftover `..` component here is
/// treated as a bug to refuse, never silently followed.
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


/// Reads from disk like every handler in this file -- `OutlineRequest` carries no dirty-buffer
/// text, so this reflects the last saved content, not unsaved editor state.
pub fn outline(req: &OutlineRequest) -> Vec<OutlineNode> {
    let project_dir = Path::new(&req.project_id);
    let Some(root) = project::detect_root(project_dir).root else {
        return Vec::new();
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);
    index.outline_for(Path::new(&req.uri))
}

/// Checked before touching disk: no reason to rebuild the whole project index for a keystroke
/// inside an argument none of these triggers recognize.
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

// Project-local symbols outrank package commands, which outrank the global fallback (math
// symbols). These constants only matter relative to each other within the same response --
// command_completions is the one place all three tiers appear together.
const PROJECT_LOCAL_PRIORITY: i32 = 0;
const PACKAGE_PRIORITY: i32 = 10;
const SYMBOL_PRIORITY: i32 = 20;

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

/// The full path (extension included) is inserted rather than an extension-less form: unambiguous
/// even if two candidates share a basename with different extensions (`plot.pdf`/`plot.png`).
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

/// `label`/`insert` deliberately omit the leading backslash -- the client's bare-command trigger
/// (`Editor.tsx`'s `wordMatch`) replaces starting right after the backslash already in the
/// document, matching how label/citation completions already replace starting after `{`.
fn command_completions(index: &crate::index::ProjectIndex) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = index
        .macros()
        .map(|m| CompletionItem {
            label: m.name.clone(),
            kind: CompletionKind::Macro,
            insert: insert_with_tabstops(&m.name, m.arity),
            // The raw substitution body -- there's nothing else to show for a "readable" detail here.
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

    // Never scoped by `\usepackage` -- these are the always-available fallback tier, unlike the package-gated block above.
    items.extend(crate::index::symbols::all().into_iter().map(|s| CompletionItem {
        label: s.name.clone(),
        kind: CompletionKind::Symbol,
        insert: s.name.clone(),
        detail: Some(s.detail),
        documentation: None,
        // KaTeX renders this client-side (`packages/ui`); the leading backslash belongs here even
        // though `insert`/`label` omit it, since this is TeX source, not a document edit.
        symbol_preview: Some(format!("\\{}", s.name)),
        sort_priority: SYMBOL_PRIORITY,
    }));

    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// `\vect` (arity 1) becomes `vect{${1:arg1}}`, `\greet` (arity 2) becomes
/// `greet{${1:arg1}}{${2:arg2}}`, and arity 0 is just the bare name with no braces. `${N:argN}`
/// rather than empty `${N}` since neither a macro definition nor the CTAN database names its own arguments.
fn insert_with_tabstops(name: &str, arity: u32) -> String {
    let mut s = name.to_string();
    for n in 1..=arity {
        s.push('{');
        s.push_str(&format!("${{{n}:arg{n}}}"));
        s.push('}');
    }
    s
}

/// Scans every `\usepackage`/`\RequirePackage`/`\documentclass` across the project, diffs the
/// resulting file candidates against bundle + cache (`crate::bundle::missing_from_cache`), and
/// fetches whatever's missing in parallel -- so the first compile after opening a project never
/// stalls mid-flight on a serial, one-at-a-time network fetch.
pub fn prefetch_packages(req: &PrefetchPackagesRequest) -> PrefetchPackagesResponse {
    let project_dir = Path::new(&req.project_id);
    let Some(root) = project::detect_root(project_dir).root else {
        return PrefetchPackagesResponse { fetched: Vec::new(), failed: Vec::new() };
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);

    // File -> the package/class name it stands for, so the response can report names (what the
    // eventual missing-package UI, task 4.4, actually shows) rather than raw filenames.
    let mut name_for_file: HashMap<String, String> = HashMap::new();
    for name in index.packages() {
        name_for_file.insert(format!("{name}.sty"), name.to_string());
    }
    for name in index.document_classes() {
        name_for_file.insert(format!("{name}.cls"), name.to_string());
    }

    let files: Vec<String> = name_for_file.keys().cloned().collect();
    let missing_files = crate::bundle::missing_from_cache(&files);
    if missing_files.is_empty() {
        return PrefetchPackagesResponse { fetched: Vec::new(), failed: Vec::new() };
    }

    let outcomes: Vec<(String, Result<u64, CompileError>)> = std::thread::scope(|scope| {
        missing_files
            .iter()
            .map(|file| scope.spawn(move || (file.clone(), crate::bundle::fetch(file))))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().expect("prefetch worker thread panicked"))
            .collect()
    });

    let mut fetched = Vec::new();
    let mut failed = Vec::new();
    for (file, result) in outcomes {
        let name = name_for_file.get(&file).cloned().unwrap_or(file);
        match result {
            Ok(bytes) => fetched.push(FetchedPackage { name, bytes }),
            Err(_) => failed.push(name),
        }
    }
    fetched.sort_by(|a, b| a.name.cmp(&b.name));
    failed.sort();
    PrefetchPackagesResponse { fetched, failed }
}

pub fn bundle_status() -> Result<BundleStatusResponse, CompileError> {
    let offline_packages = (crate::bundle::core_packages().len() + crate::bundle::cached_packages().len()) as u32;
    Ok(BundleStatusResponse {
        version: crate::bundle::digest_hex()?,
        offline_packages,
        cache_bytes: crate::bundle::cache_size_bytes() as u32,
    })
}

/// Task 4.9: whether a real, working system TeX install exists right now -- checked fresh on
/// every call, not cached, since the whole point is never offering the Settings toggle for a
/// fallback that turns out not to work.
pub fn detect_system_tex() -> DetectSystemTexResponse {
    match crate::system_tex::detect() {
        Some((engine, version)) => {
            DetectSystemTexResponse { available: true, engine: Some(engine.into()), version: Some(version) }
        }
        None => DetectSystemTexResponse { available: false, engine: None, version: None },
    }
}

/// Core (task 4.1's curated bundle, never removable) merged with whatever the cache tier
/// currently holds (task 4.3/4.4's on-demand fetches, removable) -- the real list task 4.5's
/// manager panel shows, sorted by name.
pub fn list_installed_packages() -> Vec<InstalledPackage> {
    let mut packages: Vec<InstalledPackage> = crate::bundle::core_packages()
        .into_iter()
        .map(|name| InstalledPackage { name, bytes: None, source: PackageSource::Core })
        .collect();
    packages.extend(
        crate::bundle::cached_packages()
            .into_iter()
            .map(|(name, bytes)| InstalledPackage { name, bytes: Some(bytes), source: PackageSource::Cache }),
    );
    packages.sort_by(|a, b| a.name.cmp(&b.name));
    packages
}

/// Installs a package by name directly (task 4.5's manager panel), rather than 4.3's project-scan
/// path -- a name typed here may not appear anywhere in the currently open document. Thin wrapper
/// over the same `bundle::fetch` 4.3/4.4 already use, not a second fetch mechanism: tries it as a
/// package first, then as a document class.
pub fn install_package(req: &InstallPackageRequest) -> Result<FetchedPackage, CompileError> {
    let name = req.name.clone();
    match crate::bundle::fetch(&format!("{name}.sty")) {
        Ok(bytes) => Ok(FetchedPackage { name, bytes }),
        Err(_) => {
            let bytes = crate::bundle::fetch(&format!("{name}.cls"))?;
            Ok(FetchedPackage { name, bytes })
        }
    }
}

pub fn remove_package(req: &RemovePackageRequest) -> Result<(), CompileError> {
    crate::bundle::remove_cached_package(&req.name)
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

    #[test]
    fn math_symbols_rank_below_package_commands() {
        assert!(SYMBOL_PRIORITY > PACKAGE_PRIORITY, "Section 9.4: the global fallback tier must rank below package commands");
    }

    #[test]
    fn math_symbol_completion_item_carries_a_katex_ready_preview() {
        let index = crate::index::ProjectIndex::build(&project::FileGraph { root: PathBuf::new(), files: Vec::new() });
        let items = command_completions(&index);
        let alpha = items.iter().find(|i| i.label == "alpha").expect("\\alpha should be in the bundled symbol set");
        assert_eq!(alpha.kind, CompletionKind::Symbol);
        assert_eq!(alpha.insert, "alpha", "insert omits the leading backslash, like macros/package commands");
        assert_eq!(alpha.symbol_preview.as_deref(), Some("\\alpha"), "symbolPreview is real TeX source, backslash included, for KaTeX to render");
        assert_eq!(alpha.sort_priority, SYMBOL_PRIORITY);
    }
}
