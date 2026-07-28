use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

mod root;
pub use root::{detect_root, RootConfidence, RootDetectionResult};

/// Directory names skipped when walking a project (build artifacts, VCS
/// metadata, our own shadow dir) -- shared between the file graph and
/// root detection's directory walk.
pub(crate) const SKIP_NAMES: &[&str] = &[".git", ".quire", "node_modules"];

/// Which command produced a reference. `Subfile` isn't in task 1.1's
/// literal wording (only `\input`/`\include`/`\includegraphics` are), but
/// it behaves identically for graph purposes and is extremely common in
/// practice -- the real multi-file paper used for the 0.9 gate test
/// relied on it throughout, so a graph that ignores it would be
/// incomplete for exactly the kind of document this is meant to support.
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

/// One `\input`/`\include`/`\includegraphics`/`\subfile` reference found
/// in a file, and whatever it resolved to (or didn't).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    pub command: IncludeCommand,
    /// Exactly as written in the source, e.g. `"chapters/intro"`.
    pub raw_arg: String,
    /// `None` when nothing on disk matched -- a dangling reference,
    /// which is a real state a document can be in, not something to
    /// treat as a hard error while just building the graph.
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
    /// All references across the whole graph that didn't resolve to a
    /// real file -- useful for surfacing "missing file" diagnostics later
    /// without having to walk `files` by hand.
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

/// Common image extensions graphicx itself searches when `\includegraphics`
/// is given a name with no extension.
const GRAPHIC_EXTENSIONS: &[&str] = &["pdf", "png", "jpg", "jpeg", "eps"];

/// Builds the full file graph starting from `root`, following
/// `\input`/`\include`/`\subfile` transitively and recording
/// `\includegraphics` targets as leaves. All relative paths resolve
/// against `root`'s own directory, matching TeX's actual behavior: a
/// nested file's `\input` is *not* relative to that file's own location,
/// it's relative to the main document's directory (the same reason
/// Tectonic's cwd-based resolution -- one shared cwd regardless of
/// nesting depth -- works at all). Confirmed empirically against a real
/// multi-file paper during the 0.9 gate test.
///
/// Cyclic references (a document bug, but a real one) don't cause
/// infinite recursion -- each file is parsed at most once.
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
            // Referenced but unreadable (e.g. the root itself doesn't
            // exist) -- still record it as a node with no references,
            // rather than silently dropping it from the graph.
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

    // Graphics are leaves: record them as their own nodes too (so
    // `resolved_paths`/watchers see the full real file set) without
    // parsing them for further references.
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

/// Strips TeX comments (an unescaped `%` to end of line) before scanning,
/// so a commented-out `\input` doesn't get followed. Doesn't attempt
/// verbatim-environment awareness (`\begin{verbatim}` etc.) -- a real
/// TeX tokenizer is a lot more machinery than this task needs; comments
/// are the common, cheap case worth handling, verbatim blocks containing
/// literal `\input`-looking text are not.
fn strip_comments(content: &str) -> String {
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

fn resolve_tex(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if candidate.is_file() {
        return Some(candidate);
    }
    if candidate.extension().is_none() {
        let with_ext = base_dir.join(format!("{raw}.tex"));
        if with_ext.is_file() {
            return Some(with_ext);
        }
    }
    None
}

fn resolve_graphic(raw: &str, base_dir: &Path) -> Option<PathBuf> {
    let candidate = base_dir.join(raw);
    if candidate.is_file() {
        return Some(candidate);
    }
    if candidate.extension().is_none() {
        for ext in GRAPHIC_EXTENSIONS {
            let with_ext = base_dir.join(format!("{raw}.{ext}"));
            if with_ext.is_file() {
                return Some(with_ext);
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
    fn missing_root_is_recorded_not_panicked_on() {
        let dir = temp_dir("missing-root");
        let graph = build_file_graph(&dir.join("does_not_exist.tex"));
        assert_eq!(graph.files.len(), 1);
        assert!(graph.files[0].references.is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
