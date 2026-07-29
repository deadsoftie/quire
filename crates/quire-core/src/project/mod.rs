use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

mod root;
pub use root::{detect_root, RootConfidence, RootDetectionResult};

mod watcher;
pub use watcher::FileWatcher;

/// Shared by the file graph, root detection, and the file watcher.
pub(crate) const SKIP_NAMES: &[&str] = &[".git", ".quire", "node_modules"];

/// Which command produced a reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncludeCommand {
    Input,
    Include,
    IncludeGraphics,
    Subfile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Tex,
    Graphic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub command: IncludeCommand,
    /// Exactly as written in the source, e.g. `"chapters/intro"`.
    pub raw_arg: String,
    /// `None` for a dangling reference -- a real document state, not an error.
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
    /// References across the whole graph that didn't resolve to a real file.
    pub fn unresolved(&self) -> Vec<&Reference> {
        self.files
            .iter()
            .flat_map(|f| &f.references)
            .filter(|r| r.resolved.is_none())
            .collect()
    }

    /// Every real (resolved) file in the graph, root included.
    pub fn resolved_paths(&self) -> Vec<&Path> {
        self.files.iter().map(|f| f.path.as_path()).collect()
    }
}

/// Extensions graphicx itself searches for an extensionless `\includegraphics`.
/// `pub(crate)`: `crate::index` reuses this for `\includegraphics` path completion (task 3.4)
/// rather than redefining the same list a second time.
pub(crate) const GRAPHIC_EXTENSIONS: &[&str] = &["pdf", "png", "jpg", "jpeg", "eps"];

/// Relative paths resolve against `root`'s directory, not the referencing file's own -- matching TeX's actual behavior. Cycles can't infinite-loop: each file is parsed at most once.
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
            // Unreadable (e.g. root doesn't exist) -- record it anyway, don't drop it silently.
            files.push(FileNode {
                path,
                kind: FileKind::Tex,
                references: Vec::new(),
            });
            continue;
        };

        let references = parse_references(&content, base_dir);
        for r in &references {
            if r.command != IncludeCommand::IncludeGraphics {
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

    // Graphics are leaves: recorded as nodes, not parsed for further references.
    let graphic_paths: Vec<PathBuf> = files
        .iter()
        .flat_map(|f| &f.references)
        .filter(|r| r.command == IncludeCommand::IncludeGraphics)
        .filter_map(|r| r.resolved.clone())
        .collect();

    for path in graphic_paths {
        if visited.insert(path.clone()) {
            files.push(FileNode {
                path,
                kind: FileKind::Graphic,
                references: Vec::new(),
            });
        }
    }

    FileGraph {
        root: root.to_path_buf(),
        files,
    }
}

/// Strips unescaped `%`-to-end-of-line comments so a commented-out `\input` isn't followed; doesn't special-case verbatim blocks.
/// `pub(crate)`: `crate::index` reuses this so a commented-out `\label`/section heading isn't indexed either, same reasoning.
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
        let (command, name_len) = match () {
            _ if rest.starts_with("\\includegraphics") => (IncludeCommand::IncludeGraphics, "\\includegraphics".len()),
            _ if rest.starts_with("\\input") => (IncludeCommand::Input, "\\input".len()),
            _ if rest.starts_with("\\include") => (IncludeCommand::Include, "\\include".len()),
            _ if rest.starts_with("\\subfile") => (IncludeCommand::Subfile, "\\subfile".len()),
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

        let resolved = if command == IncludeCommand::IncludeGraphics {
            resolve_graphic(&raw_arg, base_dir)
        } else {
            resolve_tex(&raw_arg, base_dir)
        };

        refs.push(Reference {
            command,
            raw_arg,
            resolved,
        });

        i += name_len;
    }

    refs
}

/// A resolved reference is only trusted if it canonicalizes to somewhere inside `base_dir` --
/// the shadow-dir mirror (`write_into_shadow`) and the UI's file tree both treat any resolved
/// path as "a file belonging to this project," so an absolute path or a `..`-laden relative one
/// (e.g. `\input{/etc/hosts}` or `\input{../../outside}`) must be rejected here as unresolved
/// rather than followed -- resolving it would let a project's own source smuggle an
/// out-of-project read/write target past every downstream consumer that trusts the graph.
/// `pub(crate)`: `crate::index` reuses this for `\bibliography`/`\addbibresource` resolution --
/// a malicious `\addbibresource{/etc/passwd}` shouldn't let the completion index read it either.
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
}
