use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

mod root;
pub use root::{detect_root, detect_root_with_dirty, RootConfidence, RootDetectionResult};
pub(crate) use root::documentclass_name;

mod watcher;
pub use watcher::FileWatcher;

pub(crate) const SKIP_NAMES: &[&str] = &[".git", ".quire", "node_modules"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncludeCommand {
    Input,
    Include,
    IncludeGraphics,
    Subfile,
    /// Covers both `\bibliography{...}` (comma-separated) and `\addbibresource{...}` (single).
    Bibliography,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Tex,
    Graphic,
    Bib,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub command: IncludeCommand,
    pub raw_arg: String,
    /// `None` for a dangling reference - a real document state, not an error.
    pub resolved: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct FileNode {
    pub path: PathBuf,
    pub kind: FileKind,
    /// Only populated for `Tex` nodes; graphics are graph leaves.
    pub references: Vec<Reference>,
}

#[derive(Debug, Clone)]
pub struct FileGraph {
    pub root: PathBuf,
    pub files: Vec<FileNode>,
}

impl FileGraph {
    pub fn unresolved(&self) -> Vec<&Reference> {
        self.files
            .iter()
            .flat_map(|f| &f.references)
            .filter(|r| r.resolved.is_none())
            .collect()
    }

    pub fn resolved_paths(&self) -> Vec<&Path> {
        self.files.iter().map(|f| f.path.as_path()).collect()
    }
}

pub(crate) const GRAPHIC_EXTENSIONS: &[&str] = &["pdf", "png", "jpg", "jpeg", "eps"];

pub fn build_file_graph(root: &Path) -> FileGraph {
    let base_dir = root.parent().unwrap_or_else(|| Path::new("."));
    let mut files = Vec::new();
    let mut visited = HashSet::new();
    let mut queue = vec![root.to_path_buf()];

    while let Some(path) = queue.pop() {
        if !visited.insert(path.clone()) {
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else {
            // Unreadable (e.g. root doesn't exist) - record it anyway, don't drop it silently.
            files.push(FileNode {
                path,
                kind: FileKind::Tex,
                references: Vec::new(),
            });
            continue;
        };

        let references = parse_references(&content, base_dir);
        for r in &references {
            // Neither a graphic nor a .bib's internal syntax is itself LaTeX source to scan further.
            if r.command != IncludeCommand::IncludeGraphics && r.command != IncludeCommand::Bibliography {
                if let Some(resolved) = &r.resolved {
                    queue.push(resolved.clone());
                }
            }
        }

        files.push(FileNode {
            path,
            kind: FileKind::Tex,
            references,
        });
    }

    let leaf_kinds = [(IncludeCommand::IncludeGraphics, FileKind::Graphic), (IncludeCommand::Bibliography, FileKind::Bib)];
    for (command, kind) in leaf_kinds {
        let paths: Vec<PathBuf> = files
            .iter()
            .flat_map(|f| &f.references)
            .filter(|r| r.command == command)
            .filter_map(|r| r.resolved.clone())
            .collect();
        for path in paths {
            if visited.insert(path.clone()) {
                files.push(FileNode { path, kind, references: Vec::new() });
            }
        }
    }

    FileGraph {
        root: root.to_path_buf(),
        files,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExplorerKind {
    File,
    Directory,
}

/// A real filesystem entry, unlike `FileNode` above which only ever covers what `\input`/
/// `\include`/`\includegraphics`/`\bibliography` actually reference.
#[derive(Debug, Clone)]
pub struct ExplorerEntry {
    pub path: PathBuf,
    pub kind: ExplorerKind,
    /// `Some` (possibly empty) for a directory, `None` for a file.
    pub children: Option<Vec<ExplorerEntry>>,
}

/// Whole-directory walk, not the LaTeX dependency graph - every file/folder under `root`
/// (`SKIP_NAMES` excluded), nested, directories first then alphabetical within each group.
pub fn build_explorer_tree(root: &Path) -> Vec<ExplorerEntry> {
    let mut visited = HashSet::new();
    walk_explorer_dir(root, &mut visited).unwrap_or_default()
}

/// Symlink-cycle-safe via the same canonicalize + visited-set pattern `root.rs`'s tex-file
/// walk and `index/mod.rs`'s two path-completion/search walks already use.
fn walk_explorer_dir(dir: &Path, visited: &mut HashSet<PathBuf>) -> Option<Vec<ExplorerEntry>> {
    let real_dir = dir.canonicalize().ok()?;
    if !visited.insert(real_dir) {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;

    let mut nodes: Vec<ExplorerEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            if SKIP_NAMES.contains(&name.to_string_lossy().as_ref()) {
                return None;
            }
            let path = entry.path();
            if path.is_dir() {
                let children = walk_explorer_dir(&path, visited).unwrap_or_default();
                Some(ExplorerEntry { path, kind: ExplorerKind::Directory, children: Some(children) })
            } else {
                Some(ExplorerEntry { path, kind: ExplorerKind::File, children: None })
            }
        })
        .collect();

    nodes.sort_by(|a, b| {
        let a_is_dir = a.kind == ExplorerKind::Directory;
        let b_is_dir = b.kind == ExplorerKind::Directory;
        b_is_dir.cmp(&a_is_dir).then_with(|| {
            a.path.file_name().map(|n| n.to_string_lossy().to_lowercase())
                .cmp(&b.path.file_name().map(|n| n.to_string_lossy().to_lowercase()))
        })
    });

    Some(nodes)
}

pub(crate) fn strip_comments(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        let mut chars = line.char_indices();
        let mut cut = line.len();
        while let Some((i, c)) = chars.next() {
            if c == '\\' {
                chars.next(); // skip the escaped character, e.g. `\%`
                continue;
            }
            if c == '%' {
                cut = i;
                break;
            }
        }
        out.push_str(&line[..cut]);
        out.push('\n');
    }
    out
}

fn parse_references(content: &str, base_dir: &Path) -> Vec<Reference> {
    let stripped = strip_comments(content);
    let mut refs = Vec::new();
    let bytes = stripped.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'\\' {
            i += 1;
            continue;
        }

        let rest = &stripped[i..];
        // is_multi_bib: \bibliography takes a comma-separated list, \addbibresource takes exactly one.
        let (command, name_len, is_multi_bib) = match () {
            _ if rest.starts_with("\\includegraphics") => (IncludeCommand::IncludeGraphics, "\\includegraphics".len(), false),
            _ if rest.starts_with("\\input") => (IncludeCommand::Input, "\\input".len(), false),
            _ if rest.starts_with("\\include") => (IncludeCommand::Include, "\\include".len(), false),
            _ if rest.starts_with("\\subfile") => (IncludeCommand::Subfile, "\\subfile".len(), false),
            // The following `{`-check rejects \bibliographystyle{...} false-matching this prefix.
            _ if rest.starts_with("\\bibliography") => (IncludeCommand::Bibliography, "\\bibliography".len(), true),
            _ if rest.starts_with("\\addbibresource") => (IncludeCommand::Bibliography, "\\addbibresource".len(), false),
            _ => {
                i += 1;
                continue;
            }
        };

        let mut after = &rest[name_len..];

        // \includegraphics takes an optional [options] block first.
        if command == IncludeCommand::IncludeGraphics {
            if let Some(stripped_after) = after.strip_prefix('[') {
                if let Some(end) = stripped_after.find(']') {
                    after = &stripped_after[end + 1..];
                }
            }
        }

        let Some(after_brace) = after.strip_prefix('{') else {
            i += name_len;
            continue;
        };
        let Some(end) = after_brace.find('}') else {
            i += name_len;
            continue;
        };
        let raw_arg = after_brace[..end].trim().to_string();

        if is_multi_bib {
            // One Reference per name, matching every other command's one-Reference-per-target convention.
            for name in raw_arg.split(',') {
                let name = name.trim();
                if name.is_empty() {
                    continue;
                }
                refs.push(Reference { command, raw_arg: name.to_string(), resolved: resolve_bib(name, base_dir) });
            }
        } else {
            let resolved = match command {
                IncludeCommand::IncludeGraphics => resolve_graphic(&raw_arg, base_dir),
                IncludeCommand::Bibliography => resolve_bib(&raw_arg, base_dir),
                _ => resolve_tex(&raw_arg, base_dir),
            };
            refs.push(Reference { command, raw_arg, resolved });
        }

        i += name_len;
    }

    refs
}

/// Rejects an absolute or `..`-laden path as unresolved - otherwise project source could smuggle an out-of-project read/write target past every downstream consumer.
pub(crate) fn resolve_within(base_dir: &Path, candidate: PathBuf) -> Option<PathBuf> {
    if !candidate.is_file() {
        return None;
    }
    let base_real = base_dir.canonicalize().ok()?;
    let candidate_real = candidate.canonicalize().ok()?;
    if candidate_real.starts_with(&base_real) {
        Some(candidate)
    } else {
        None
    }
}

fn resolve_tex(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if let Some(resolved) = resolve_within(base_dir, candidate.clone()) {
        return Some(resolved);
    }
    if candidate.extension().is_none() {
        let with_ext = base_dir.join(format!("{raw}.tex"));
        if let Some(resolved) = resolve_within(base_dir, with_ext) {
            return Some(resolved);
        }
    }
    None
}

fn resolve_bib(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if let Some(resolved) = resolve_within(base_dir, candidate.clone()) {
        return Some(resolved);
    }
    if candidate.extension().is_none() {
        let with_ext = base_dir.join(format!("{raw}.bib"));
        if let Some(resolved) = resolve_within(base_dir, with_ext) {
            return Some(resolved);
        }
    }
    None
}

fn resolve_graphic(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if let Some(resolved) = resolve_within(base_dir, candidate.clone()) {
        return Some(resolved);
    }
    if candidate.extension().is_none() {
        for ext in GRAPHIC_EXTENSIONS {
            let with_ext = base_dir.join(format!("{raw}.{ext}"));
            if let Some(resolved) = resolve_within(base_dir, with_ext) {
                return Some(resolved);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("quire-project-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn strip_comments_handles_escaped_percent_but_not_real_comments() {
        let input = "Cost is 50\\% off\nreal comment % \\input{ignored}\nplain line";
        let stripped = strip_comments(input);
        assert!(stripped.contains("Cost is 50\\% off"), "escaped percent must survive: {stripped:?}");
        assert!(!stripped.contains("ignored"), "text after a real comment marker must be gone: {stripped:?}");
        assert!(stripped.contains("real comment"), "text before the comment marker must survive: {stripped:?}");
    }

    #[test]
    fn cyclic_input_does_not_infinite_loop() {
        let dir = temp_dir("cycle");
        fs::write(dir.join("a.tex"), "\\input{b}").unwrap();
        fs::write(dir.join("b.tex"), "\\input{a}").unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));

        let tex_paths: Vec<&Path> = graph.files.iter().map(|f| f.path.as_path()).collect();
        assert_eq!(tex_paths.len(), 2, "each file visited exactly once: {tex_paths:?}");
        assert!(tex_paths.contains(&dir.join("a.tex").as_path()));
        assert!(tex_paths.contains(&dir.join("b.tex").as_path()));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bibliography_command_resolves_and_becomes_a_bib_leaf() {
        let dir = temp_dir("bib-single");
        fs::write(dir.join("refs.bib"), "@article{k,}").unwrap();
        fs::write(dir.join("a.tex"), "\\bibliography{refs}").unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));
        let bib_files: Vec<&FileNode> = graph.files.iter().filter(|f| f.kind == FileKind::Bib).collect();
        assert_eq!(bib_files.len(), 1, "{graph:?}");
        assert_eq!(bib_files[0].path, dir.join("refs.bib"));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bibliography_command_splits_comma_separated_names() {
        let dir = temp_dir("bib-multi");
        fs::write(dir.join("refs1.bib"), "@article{k,}").unwrap();
        fs::write(dir.join("refs2.bib"), "@article{k,}").unwrap();
        fs::write(dir.join("a.tex"), "\\bibliography{refs1,refs2}").unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));
        let bib_paths: HashSet<&Path> =
            graph.files.iter().filter(|f| f.kind == FileKind::Bib).map(|f| f.path.as_path()).collect();
        assert_eq!(bib_paths.len(), 2, "{graph:?}");
        assert!(bib_paths.contains(dir.join("refs1.bib").as_path()));
        assert!(bib_paths.contains(dir.join("refs2.bib").as_path()));

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn addbibresource_resolves_like_bibliography() {
        let dir = temp_dir("bib-biblatex");
        fs::write(dir.join("refs.bib"), "@article{k,}").unwrap();
        fs::write(dir.join("a.tex"), "\\addbibresource{refs.bib}").unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));
        let bib_files: Vec<&FileNode> = graph.files.iter().filter(|f| f.kind == FileKind::Bib).collect();
        assert_eq!(bib_files.len(), 1, "{graph:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bibliographystyle_is_not_mistaken_for_bibliography() {
        let dir = temp_dir("bib-style");
        fs::write(dir.join("a.tex"), "\\bibliographystyle{plain}").unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));
        assert!(graph.files.iter().all(|f| f.kind != FileKind::Bib), "{graph:?}");
        assert!(graph.files[0].references.is_empty(), "{graph:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn absolute_input_target_outside_project_is_not_resolved() {
        let dir = temp_dir("escape-absolute");
        let outside = temp_dir("escape-absolute-target");
        fs::write(outside.join("secret.tex"), "outside content").unwrap();

        let outside_path = outside.join("secret").display().to_string();
        fs::write(dir.join("a.tex"), format!("\\input{{{outside_path}}}")).unwrap();

        let graph = build_file_graph(&dir.join("a.tex"));
        assert_eq!(graph.files.len(), 1, "the outside file must not enter the graph: {graph:?}");
        let refs = &graph.files[0].references;
        assert_eq!(refs.len(), 1);
        assert!(refs[0].resolved.is_none(), "an absolute path outside the project must be unresolved");

        fs::remove_dir_all(&dir).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn dotdot_input_target_outside_project_is_not_resolved() {
        let dir = temp_dir("escape-dotdot");
        fs::create_dir_all(dir.join("project")).unwrap();
        fs::write(dir.join("outside.tex"), "outside content").unwrap();
        fs::write(dir.join("project").join("a.tex"), "\\input{../outside}").unwrap();

        let graph = build_file_graph(&dir.join("project").join("a.tex"));
        assert_eq!(graph.files.len(), 1, "the outside file must not enter the graph: {graph:?}");
        assert!(graph.files[0].references[0].resolved.is_none());

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_root_is_recorded_not_panicked_on() {
        let dir = temp_dir("missing-root");
        let graph = build_file_graph(&dir.join("does_not_exist.tex"));
        assert_eq!(graph.files.len(), 1);
        assert!(graph.files[0].references.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explorer_tree_shows_files_the_latex_graph_never_would() {
        let dir = temp_dir("explorer-full-walk");
        fs::write(dir.join("main.tex"), "\\documentclass{article}").unwrap();
        fs::write(dir.join("notes.md"), "unreferenced").unwrap();
        fs::create_dir_all(dir.join("data")).unwrap();
        fs::write(dir.join("data").join("values.csv"), "1,2,3").unwrap();

        let tree = build_explorer_tree(&dir);
        let names: Vec<String> =
            tree.iter().map(|n| n.path.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert!(names.contains(&"notes.md".to_string()), "{names:?}");
        assert!(names.contains(&"data".to_string()), "{names:?}");

        let data_node = tree.iter().find(|n| n.kind == ExplorerKind::Directory).expect("data dir present");
        let children = data_node.children.as_ref().expect("directories carry children");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].path.file_name().unwrap(), "values.csv");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explorer_tree_sorts_directories_before_files_alphabetically() {
        let dir = temp_dir("explorer-sort");
        fs::write(dir.join("zeta.tex"), "").unwrap();
        fs::create_dir_all(dir.join("alpha-dir")).unwrap();
        fs::write(dir.join("beta.tex"), "").unwrap();

        let tree = build_explorer_tree(&dir);
        let names: Vec<String> =
            tree.iter().map(|n| n.path.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["alpha-dir", "beta.tex", "zeta.tex"]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explorer_tree_excludes_skip_names() {
        let dir = temp_dir("explorer-skip");
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join(".quire")).unwrap();
        fs::write(dir.join("main.tex"), "").unwrap();

        let tree = build_explorer_tree(&dir);
        let names: Vec<String> =
            tree.iter().map(|n| n.path.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["main.tex"], "{names:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn explorer_tree_self_referential_symlink_does_not_recurse_forever() {
        let dir = temp_dir("explorer-symlink-cycle");
        fs::write(dir.join("main.tex"), "").unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();

        let tree = build_explorer_tree(&dir);
        let names: Vec<String> =
            tree.iter().map(|n| n.path.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert!(names.contains(&"main.tex".to_string()), "{names:?}");

        fs::remove_dir_all(&dir).unwrap();
    }
}
