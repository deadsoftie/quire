//! No `cancel_compile`: the caller kills the OS process instead. No project registry either - `ProjectId` is just the project's root directory path.

use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{collections::HashMap, fs};

use regex::Regex;

use crate::project::{self, FileKind};
use crate::rerun::compile_latex_in_dir;
use crate::rpc::*;
use crate::CompileError;

pub fn open_project(req: &OpenProjectRequest) -> Result<OpenProjectResponse, CompileError> {
    let project_dir = Path::new(&req.path);
    let detection = project::detect_root(project_dir);

    // `root: DocUri` isn't optional, so an ambiguous result still needs a best guess - the first sorted candidate; `candidates` carries the full list for the UI to prompt with.
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

/// No server-side state to update - just validates `uri` so the caller can trust what it's about
/// to remember (as a compile-time `targetRoot`, in practice - see `compile`'s own re-validation
/// of that field, which never trusts this call happened first).
pub fn set_root(req: &SetRootRequest) -> Result<(), CompileError> {
    let project_dir = Path::new(&req.project_id);
    let target = Path::new(&req.uri);
    ensure_within_project(project_dir, target)?;
    if !target.extension().is_some_and(|e| e.eq_ignore_ascii_case("tex")) {
        return Err(CompileError { message: format!("{} is not a .tex file", req.uri), log: None });
    }
    if !target.is_file() {
        return Err(CompileError { message: format!("{} is not a file", req.uri), log: None });
    }
    Ok(())
}

/// No-op - no server-side resource is tied to a project to release.
pub fn close_project(_req: &CloseProjectRequest) -> Result<(), CompileError> {
    Ok(())
}

/// A LaTeX failure is a normal `status: "errors"` result; `Err` is reserved for an unserviceable request.
pub fn compile(req: &CompileRequest) -> Result<CompileResponse, CompileError> {
    let start = Instant::now();
    let project_dir = PathBuf::from(&req.project_id);
    let shadow_dir = project_dir.join(".quire").join("build");

    let dirty: HashMap<PathBuf, &str> =
        req.dirty_buffers.iter().map(|b| (PathBuf::from(&b.uri), b.text.as_str())).collect();

    // Client-chosen root override ("targeting"): a full override, not a hint blended into
    // detection, and independently re-validated here rather than trusted from an earlier
    // setRoot() call (core holds no state; the file could have moved/vanished since). An
    // override that no longer resolves silently falls through to normal detection below rather
    // than failing the whole compile over a stale client-side value.
    let target = req.target_root.as_deref().map(PathBuf::from).filter(|candidate| {
        candidate.is_file() && ensure_within_project(&project_dir, candidate).is_ok()
    });

    let root = match target {
        Some(root) => root,
        None => {
            // Detection must see unsaved buffers, or a just-created empty file can't be the root until saved.
            let detection = project::detect_root_with_dirty(&project_dir, &dirty);
            // Mirrors open_project's own fallback: a best guess beats refusing to compile at all.
            detection.root.or_else(|| detection.candidates.first().cloned()).ok_or_else(|| CompileError {
                message: "no .tex file found in this project".to_string(),
                log: None,
            })?
        }
    };

    let graph = project::build_file_graph(&root);
    let mut root_source = None;

    for file in &graph.files {
        if file.kind != FileKind::Tex {
            continue; // non-Tex files (graphics, bib resources) are copied as-is below, never dirty-buffer-overridden
        }

        let content = match dirty.get(&file.path) {
            Some(text) => text.to_string(),
            None => fs::read_to_string(&file.path).unwrap_or_default(),
        };

        if file.path == root {
            root_source = Some(content.clone());
        }

        write_into_shadow(&project_dir, &shadow_dir, &file.path, content.as_bytes())?;
    }

    // Non-Tex files never come from dirty buffers - copy the real bytes into the shadow dir.
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
                // Re-detected here, not trusted from an earlier detectSystemTex() call, since core holds no state.
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
                        root: root_uri.clone(),
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
            root: root_uri.clone(),
        },
        Err(e) => {
            let missing_packages = e.log.as_deref().map(crate::diagnostics::missing_packages).unwrap_or_default();
            let translated = e
                .log
                .as_deref()
                .map(|log| crate::diagnostics::translate_log(log, &root_uri, &project_dir))
                .unwrap_or_default();
            // A log the translator recognized nothing in still needs to reach the user as something.
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
            // A missing package takes priority over generic errors - it's the one failure mode with a real fix path.
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
                root: root_uri,
            }
        }
    };

    Ok(response)
}

/// Last line of defense: `resolve_within` already confines references, but any escape here is refused, never followed.
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


/// Reads from disk - `OutlineRequest` carries no dirty-buffer text, so this reflects last-saved content only.
pub fn outline(req: &OutlineRequest) -> Vec<OutlineNode> {
    let project_dir = Path::new(&req.project_id);
    let Some(root) = resolve_root_for_uri(project_dir, &req.uri) else {
        return Vec::new();
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);
    index.outline_for(Path::new(&req.uri))
}

/// Root detection is project-wide, so a workspace holding several independent standalone
/// documents (no `\input`/`\include` chain between them) comes back `Ambiguous` for all of
/// them. When that happens, fall back to treating the requested file as its own root if it's
/// one of the candidates, so an unambiguous document isn't starved by unrelated siblings.
fn resolve_root_for_uri(project_dir: &Path, uri: &str) -> Option<PathBuf> {
    let detection = project::detect_root(project_dir);
    detection.root.or_else(|| {
        let uri_path = Path::new(uri);
        detection.candidates.into_iter().find(|c| c == uri_path)
    })
}

/// Checked before touching disk: no reason to rebuild the index for a keystroke none of these triggers recognize.
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
    let Some(root) = resolve_root_for_uri(project_dir, &req.uri) else {
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

// Project-local symbols outrank package commands, which outrank the global math-symbol fallback.
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

/// Inserts the full path with extension, unambiguous even when two candidates share a basename.
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

/// `label`/`insert` omit the leading backslash - the client's trigger replaces starting right after it.
fn command_completions(index: &crate::index::ProjectIndex) -> Vec<CompletionItem> {
    let mut items: Vec<CompletionItem> = index
        .macros()
        .map(|m| CompletionItem {
            label: m.name.clone(),
            kind: CompletionKind::Macro,
            insert: insert_with_tabstops(&m.name, m.arity),
            // The raw substitution body - there's nothing else to show for a "readable" detail here.
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

    // Never scoped by `\usepackage` - these are the always-available fallback tier, unlike the package-gated block above.
    items.extend(crate::index::symbols::all().into_iter().map(|s| CompletionItem {
        label: s.name.clone(),
        kind: CompletionKind::Symbol,
        insert: s.name.clone(),
        detail: Some(s.detail),
        documentation: None,
        // TeX source for client-side KaTeX rendering, so the backslash belongs here unlike insert/label.
        symbol_preview: Some(format!("\\{}", s.name)),
        sort_priority: SYMBOL_PRIORITY,
    }));

    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// `\vect` (arity 1) becomes `vect{${1:arg1}}`; arity 0 is just the bare name with no braces.
fn insert_with_tabstops(name: &str, arity: u32) -> String {
    let mut s = name.to_string();
    for n in 1..=arity {
        s.push('{');
        s.push_str(&format!("${{{n}:arg{n}}}"));
        s.push('}');
    }
    s
}

/// Scans every package/class the project uses and fetches whatever's missing in parallel, so the first compile never stalls on serial fetches.
pub fn prefetch_packages(req: &PrefetchPackagesRequest) -> PrefetchPackagesResponse {
    let project_dir = Path::new(&req.project_id);
    let Some(root) = project::detect_root(project_dir).root else {
        return PrefetchPackagesResponse { fetched: Vec::new(), failed: Vec::new() };
    };
    let graph = project::build_file_graph(&root);
    let index = crate::index::ProjectIndex::build(&graph);

    // File -> the package/class name it stands for, so the response reports names, not raw filenames.
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

/// Checked fresh every call, never cached, so the Settings toggle is never offered for a fallback that doesn't actually work.
pub fn detect_system_tex() -> DetectSystemTexResponse {
    match crate::system_tex::detect() {
        Some((engine, version)) => {
            DetectSystemTexResponse { available: true, engine: Some(engine.into()), version: Some(version) }
        }
        None => DetectSystemTexResponse { available: false, engine: None, version: None },
    }
}

/// The curated core bundle (never removable) merged with whatever the cache tier currently holds (removable), sorted by name.
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

/// Installs a package by name directly, not via a project scan - tries it as a package first, then as a document class.
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

fn explorer_node_from(entry: project::ExplorerEntry) -> ExplorerNode {
    ExplorerNode {
        uri: entry.path.display().to_string(),
        name: entry.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        kind: match entry.kind {
            project::ExplorerKind::File => ExplorerNodeKind::File,
            project::ExplorerKind::Directory => ExplorerNodeKind::Directory,
        },
        children: entry.children.map(|c| c.into_iter().map(explorer_node_from).collect()),
    }
}

pub fn list_project_tree(req: &ListProjectTreeRequest) -> Vec<ExplorerNode> {
    let project_dir = Path::new(&req.project_id);
    project::build_explorer_tree(project_dir).into_iter().map(explorer_node_from).collect()
}

/// Rejects a typed name that could otherwise smuggle a path escape (`../x`, an embedded
/// separator) past the containment check below, which only ever validates whole paths.
fn sanitize_entry_name(name: &str) -> Result<&str, CompileError> {
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err(CompileError { message: format!("\"{name}\" is not a valid file or folder name"), log: None });
    }
    Ok(name)
}

/// Same intent as `project::resolve_within` (used for parsed LaTeX references), applied to
/// paths that arrive over RPC instead: canonicalize and require containment inside `project_dir`.
fn ensure_within_project(project_dir: &Path, candidate: &Path) -> Result<(), CompileError> {
    let base_real = project_dir
        .canonicalize()
        .map_err(|_| CompileError { message: "project directory not found".to_string(), log: None })?;
    let real = candidate
        .canonicalize()
        .map_err(|_| CompileError { message: format!("{} not found", candidate.display()), log: None })?;
    if real.starts_with(&base_real) {
        Ok(())
    } else {
        Err(CompileError { message: format!("{} is outside the project directory", candidate.display()), log: None })
    }
}

fn ensure_absent(target: &Path) -> Result<(), CompileError> {
    if target.exists() {
        Err(CompileError { message: format!("{} already exists", target.display()), log: None })
    } else {
        Ok(())
    }
}

pub fn create_file(req: &CreateFileRequest) -> Result<EntryResponse, CompileError> {
    let project_dir = Path::new(&req.project_id);
    let parent = Path::new(&req.parent_uri);
    ensure_within_project(project_dir, parent)?;
    let target = parent.join(sanitize_entry_name(&req.name)?);
    ensure_absent(&target)?;
    fs::write(&target, b"")?;
    Ok(EntryResponse { uri: target.display().to_string() })
}

pub fn create_directory(req: &CreateDirectoryRequest) -> Result<EntryResponse, CompileError> {
    let project_dir = Path::new(&req.project_id);
    let parent = Path::new(&req.parent_uri);
    ensure_within_project(project_dir, parent)?;
    let target = parent.join(sanitize_entry_name(&req.name)?);
    ensure_absent(&target)?;
    fs::create_dir(&target)?;
    Ok(EntryResponse { uri: target.display().to_string() })
}

pub fn rename_entry(req: &RenameEntryRequest) -> Result<EntryResponse, CompileError> {
    let project_dir = Path::new(&req.project_id);
    let source = Path::new(&req.uri);
    ensure_within_project(project_dir, source)?;
    let parent = source
        .parent()
        .ok_or_else(|| CompileError { message: "cannot rename the project root".to_string(), log: None })?;
    let target = parent.join(sanitize_entry_name(&req.new_name)?);
    ensure_absent(&target)?;
    fs::rename(source, &target)?;
    Ok(EntryResponse { uri: target.display().to_string() })
}

pub fn move_entry(req: &MoveEntryRequest) -> Result<EntryResponse, CompileError> {
    let project_dir = Path::new(&req.project_id);
    let source = Path::new(&req.uri);
    ensure_within_project(project_dir, source)?;
    let new_parent = Path::new(&req.new_parent_uri);
    ensure_within_project(project_dir, new_parent)?;
    let name = source
        .file_name()
        .ok_or_else(|| CompileError { message: "cannot move the project root".to_string(), log: None })?;
    let target = new_parent.join(name);
    ensure_absent(&target)?;
    fs::rename(source, &target)?;
    Ok(EntryResponse { uri: target.display().to_string() })
}

pub fn copy_entry(req: &CopyEntryRequest) -> Result<EntryResponse, CompileError> {
    let project_dir = Path::new(&req.project_id);
    let source = Path::new(&req.uri);
    ensure_within_project(project_dir, source)?;
    let dest_parent = Path::new(&req.dest_parent_uri);
    ensure_within_project(project_dir, dest_parent)?;
    let name = match &req.new_name {
        Some(n) => sanitize_entry_name(n)?.to_string(),
        None => source
            .file_name()
            .ok_or_else(|| CompileError { message: "cannot copy the project root".to_string(), log: None })?
            .to_string_lossy()
            .into_owned(),
    };
    let target = dest_parent.join(&name);
    ensure_absent(&target)?;
    if source.is_dir() {
        copy_dir_recursive(source, &target)?;
    } else {
        fs::copy(source, &target)?;
    }
    Ok(EntryResponse { uri: target.display().to_string() })
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), CompileError> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

const MAX_SEARCH_MATCHES: usize = 5000;

/// Escapes/wraps a literal query into a regex when `regex` is false; a bad user-supplied regex surfaces as a normal RPC error.
fn build_search_regex(query: &str, case_sensitive: bool, whole_word: bool, regex: bool) -> Result<Regex, CompileError> {
    let core = if regex { query.to_string() } else { regex::escape(query) };
    let bounded = if whole_word { format!(r"\b(?:{core})\b") } else { core };
    let pattern = if case_sensitive { bounded } else { format!("(?i){bounded}") };
    Regex::new(&pattern).map_err(|e| CompileError { message: format!("invalid search pattern: {e}"), log: None })
}

pub fn search_project(req: &SearchProjectRequest) -> Result<SearchProjectResponse, CompileError> {
    if req.query.is_empty() {
        return Ok(SearchProjectResponse { matches: Vec::new(), truncated: false });
    }

    let project_dir = PathBuf::from(&req.project_id);
    let dirty: HashMap<PathBuf, &str> =
        req.dirty_buffers.iter().map(|b| (PathBuf::from(&b.uri), b.text.as_str())).collect();
    let pattern = build_search_regex(&req.query, req.case_sensitive, req.whole_word, req.regex)?;

    let mut matches = Vec::new();
    let mut truncated = false;
    'files: for path in crate::index::all_searchable_files(&project_dir) {
        // Unreadable (e.g. binary/corrupt) files are skipped, not fatal to the whole search.
        let content = match dirty.get(&path) {
            Some(text) => text.to_string(),
            None => match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            },
        };
        let uri = path.display().to_string();

        for (line_idx, line) in content.lines().enumerate() {
            for m in pattern.find_iter(line) {
                if matches.len() >= MAX_SEARCH_MATCHES {
                    truncated = true;
                    break 'files;
                }
                matches.push(SearchMatch {
                    uri: uri.clone(),
                    line: line_idx as u32,
                    column: line[..m.start()].encode_utf16().count() as u32,
                    line_text: line.to_string(),
                    match_length: line[m.start()..m.end()].encode_utf16().count() as u32,
                });
            }
        }
    }

    Ok(SearchProjectResponse { matches, truncated })
}

pub fn replace_in_project(req: &ReplaceInProjectRequest) -> Result<ReplaceInProjectResponse, CompileError> {
    if req.query.is_empty() {
        return Ok(ReplaceInProjectResponse { files: Vec::new() });
    }

    let project_dir = PathBuf::from(&req.project_id);
    let dirty: HashMap<PathBuf, &str> =
        req.dirty_buffers.iter().map(|b| (PathBuf::from(&b.uri), b.text.as_str())).collect();
    let pattern = build_search_regex(&req.query, req.case_sensitive, req.whole_word, req.regex)?;

    let mut files = Vec::new();
    for path in crate::index::all_searchable_files(&project_dir) {
        let content = match dirty.get(&path) {
            Some(text) => text.to_string(),
            None => match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            },
        };

        let replacements = pattern.find_iter(&content).count();
        if replacements == 0 {
            continue;
        }

        // NoExpand for the literal case: $1-style expansion applies to the replacement text regardless of pattern.
        let new_text = if req.regex {
            pattern.replace_all(&content, req.replacement.as_str()).into_owned()
        } else {
            pattern.replace_all(&content, regex::NoExpand(&req.replacement)).into_owned()
        };

        fs::write(&path, &new_text)?;
        files.push(ReplacedFile { uri: path.display().to_string(), replacements: replacements as u32, new_text });
    }

    Ok(ReplaceInProjectResponse { files })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quire-handlers-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_file_writes_an_empty_file_under_the_parent() {
        let dir = temp_project("create-file");
        let resp = create_file(&CreateFileRequest {
            project_id: dir.display().to_string(),
            parent_uri: dir.display().to_string(),
            name: "notes.md".to_string(),
        })
        .unwrap();
        assert_eq!(resp.uri, dir.join("notes.md").display().to_string());
        assert_eq!(fs::read_to_string(dir.join("notes.md")).unwrap(), "");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_file_rejects_a_name_that_already_exists() {
        let dir = temp_project("create-file-exists");
        fs::write(dir.join("notes.md"), "existing").unwrap();
        let result = create_file(&CreateFileRequest {
            project_id: dir.display().to_string(),
            parent_uri: dir.display().to_string(),
            name: "notes.md".to_string(),
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(dir.join("notes.md")).unwrap(), "existing", "must not clobber the existing file");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_file_rejects_a_dotdot_name_escaping_the_project() {
        let dir = temp_project("create-file-escape");
        let result = create_file(&CreateFileRequest {
            project_id: dir.display().to_string(),
            parent_uri: dir.display().to_string(),
            name: "../escaped.tex".to_string(),
        });
        assert!(result.is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn create_directory_rejects_a_parent_outside_the_project() {
        let dir = temp_project("create-dir-outside");
        let outside = temp_project("create-dir-outside-target");
        let result = create_directory(&CreateDirectoryRequest {
            project_id: dir.display().to_string(),
            parent_uri: outside.display().to_string(),
            name: "new-folder".to_string(),
        });
        assert!(result.is_err(), "a parent outside the project directory must be rejected");
        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn rename_entry_renames_in_place_and_preserves_content() {
        let dir = temp_project("rename");
        fs::write(dir.join("old.tex"), "content").unwrap();
        let resp = rename_entry(&RenameEntryRequest {
            project_id: dir.display().to_string(),
            uri: dir.join("old.tex").display().to_string(),
            new_name: "new.tex".to_string(),
        })
        .unwrap();
        assert_eq!(resp.uri, dir.join("new.tex").display().to_string());
        assert!(!dir.join("old.tex").exists());
        assert_eq!(fs::read_to_string(dir.join("new.tex")).unwrap(), "content");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn move_entry_moves_into_a_different_directory() {
        let dir = temp_project("move");
        fs::create_dir_all(dir.join("chapters")).unwrap();
        fs::write(dir.join("intro.tex"), "intro").unwrap();
        let resp = move_entry(&MoveEntryRequest {
            project_id: dir.display().to_string(),
            uri: dir.join("intro.tex").display().to_string(),
            new_parent_uri: dir.join("chapters").display().to_string(),
        })
        .unwrap();
        assert_eq!(resp.uri, dir.join("chapters").join("intro.tex").display().to_string());
        assert!(!dir.join("intro.tex").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn copy_entry_duplicates_a_directory_recursively() {
        let dir = temp_project("copy-dir");
        fs::create_dir_all(dir.join("figures")).unwrap();
        fs::write(dir.join("figures").join("plot.png"), "bytes").unwrap();
        let resp = copy_entry(&CopyEntryRequest {
            project_id: dir.display().to_string(),
            uri: dir.join("figures").display().to_string(),
            dest_parent_uri: dir.display().to_string(),
            new_name: Some("figures-copy".to_string()),
        })
        .unwrap();
        assert_eq!(resp.uri, dir.join("figures-copy").display().to_string());
        assert_eq!(fs::read_to_string(dir.join("figures-copy").join("plot.png")).unwrap(), "bytes");
        assert!(dir.join("figures").join("plot.png").exists(), "the original must be untouched");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_project_tree_returns_every_file_not_just_the_latex_graph() {
        let dir = temp_project("list-tree");
        fs::write(dir.join("main.tex"), "\\documentclass{article}").unwrap();
        fs::write(dir.join("notes.md"), "unreferenced").unwrap();
        let tree = list_project_tree(&ListProjectTreeRequest { project_id: dir.display().to_string() });
        let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"notes.md"), "{names:?}");
        assert!(names.contains(&"main.tex"), "{names:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

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
