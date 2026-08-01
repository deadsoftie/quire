use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::{parse_references, strip_comments, IncludeCommand, SKIP_NAMES};

/// Reads `path`'s content, preferring an unsaved editor buffer over disk -- lets root detection
/// see a brand-new file's pasted-but-not-yet-saved `\documentclass` instead of the empty file
/// `desktop:createFile` writes to disk.
fn read_content(path: &Path, dirty: &HashMap<PathBuf, &str>) -> Option<String> {
    if let Some(text) = dirty.get(path) {
        return Some((*text).to_string());
    }
    fs::read_to_string(path).ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootConfidence {
    Explicit,
    Inferred,
    Ambiguous,
}

#[derive(Debug, Clone)]
pub struct RootDetectionResult {
    pub root: Option<PathBuf>,
    pub confidence: RootConfidence,
    /// Populated when ambiguous.
    pub candidates: Vec<PathBuf>,
}

pub fn detect_root(project_dir: &Path) -> RootDetectionResult {
    detect_root_with_dirty(project_dir, &HashMap::new())
}

/// Same as `detect_root`, but `dirty` (unsaved editor buffers, keyed by absolute path) takes
/// precedence over on-disk content -- `compile` needs this so a file created and pasted into but
/// not yet saved can still be recognized as the root document.
pub fn detect_root_with_dirty(project_dir: &Path, dirty: &HashMap<PathBuf, &str>) -> RootDetectionResult {
    let tex_files = find_all_tex_files(project_dir);

    if let Some(root) = detect_explicit(&tex_files, dirty) {
        return RootDetectionResult {
            root: Some(root),
            confidence: RootConfidence::Explicit,
            candidates: Vec::new(),
        };
    }

    let documentclass_files = files_with_real_documentclass(&tex_files, dirty);
    if documentclass_files.len() == 1 {
        return RootDetectionResult {
            root: Some(documentclass_files[0].clone()),
            confidence: RootConfidence::Inferred,
            candidates: Vec::new(),
        };
    }

    // Fallback: the file with the highest \input/\include/\subfile out-degree, not literally "most included" (that would tend to pick a shared preamble file).
    let search_scope: Vec<PathBuf> = if documentclass_files.is_empty() {
        tex_files.clone()
    } else {
        documentclass_files
    };

    let out_degrees = compute_out_degrees(&search_scope, project_dir, dirty);
    let max_degree = out_degrees.values().copied().max().unwrap_or(0);

    if max_degree > 0 {
        let top: Vec<&PathBuf> = out_degrees
            .iter()
            .filter(|(_, &d)| d == max_degree)
            .map(|(p, _)| p)
            .collect();

        if top.len() == 1 {
            return RootDetectionResult {
                root: Some(top[0].clone()),
                confidence: RootConfidence::Inferred,
                candidates: Vec::new(),
            };
        }

        let mut candidates: Vec<PathBuf> = top.into_iter().cloned().collect();
        candidates.sort();
        return RootDetectionResult {
            root: None,
            confidence: RootConfidence::Ambiguous,
            candidates,
        };
    }

    let mut candidates = search_scope;
    candidates.sort();
    RootDetectionResult {
        root: None,
        confidence: RootConfidence::Ambiguous,
        candidates,
    }
}

fn find_all_tex_files(dir: &Path) -> Vec<PathBuf> {
    let mut visited = HashSet::new();
    let mut results = Vec::new();
    find_all_tex_files_into(dir, &mut visited, &mut results);
    results
}

/// `Path::is_dir()` follows symlinks, so a self-referential symlink would otherwise recurse
/// forever; tracking `visited` by canonicalized path breaks the cycle.
fn find_all_tex_files_into(dir: &Path, visited: &mut HashSet<PathBuf>, results: &mut Vec<PathBuf>) {
    let Ok(real_dir) = dir.canonicalize() else {
        return;
    };
    if !visited.insert(real_dir) {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if SKIP_NAMES.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            find_all_tex_files_into(&path, visited, results);
        } else if path.extension().is_some_and(|e| e == "tex") {
            results.push(path);
        }
    }
}

/// `% !TEX root = <path>` markers (TeXShop/TeXWorks convention); disagreeing markers fall through to inference rather than guessing.
fn detect_explicit(tex_files: &[PathBuf], dirty: &HashMap<PathBuf, &str>) -> Option<PathBuf> {
    let mut resolved: HashSet<PathBuf> = HashSet::new();

    for file in tex_files {
        let Some(content) = read_content(file, dirty) else { continue };
        for line in content.lines().take(20) {
            let trimmed = line.trim();
            let Some(rest) = trimmed
                .strip_prefix('%')
                .map(str::trim_start)
                .and_then(|s| s.strip_prefix("!TEX root"))
            else {
                continue;
            };
            let Some(value) = rest.trim_start().strip_prefix('=') else { continue };
            let target_raw = value.trim();
            if target_raw.is_empty() {
                continue;
            }

            let base = file.parent().unwrap_or_else(|| Path::new("."));
            let candidate = base.join(target_raw);
            if let Ok(canonical) = candidate.canonicalize() {
                resolved.insert(canonical);
            } else if candidate.is_file() {
                resolved.insert(candidate);
            }
        }
    }

    if resolved.len() == 1 {
        resolved.into_iter().next()
    } else {
        None
    }
}

/// Excludes `subfiles`-classed files -- each subfiles chapter has its own `\documentclass` too, which would otherwise make such a project always look ambiguous.
fn files_with_real_documentclass(tex_files: &[PathBuf], dirty: &HashMap<PathBuf, &str>) -> Vec<PathBuf> {
    tex_files
        .iter()
        .filter(|f| {
            read_content(f, dirty)
                .map(|content| strip_comments(&content))
                .and_then(|content| documentclass_name(&content))
                .is_some_and(|name| name != "subfiles")
        })
        .cloned()
        .collect()
}

pub(crate) fn documentclass_name(content: &str) -> Option<String> {
    let idx = content.find("\\documentclass")?;
    let rest = &content[idx + "\\documentclass".len()..];
    let rest = match rest.trim_start().strip_prefix('[') {
        Some(after_bracket) => {
            let end = after_bracket.find(']')?;
            &after_bracket[end + 1..]
        }
        None => rest,
    };
    let rest = rest.trim_start().strip_prefix('{')?;
    let end = rest.find('}')?;
    Some(rest[..end].trim().to_string())
}

fn compute_out_degrees(files: &[PathBuf], project_dir: &Path, dirty: &HashMap<PathBuf, &str>) -> HashMap<PathBuf, usize> {
    let mut degrees = HashMap::new();
    for file in files {
        let Some(content) = read_content(file, dirty) else {
            degrees.insert(file.clone(), 0);
            continue;
        };
        let refs = parse_references(&content, project_dir);
        // Neither a graphic nor a bibliography is a candidate sub-document, so neither should
        // count toward "how many other documents does this file pull in" -- and every real root
        // document has exactly one \bibliography, so counting it wouldn't discriminate anyway.
        let distinct: HashSet<PathBuf> = refs
            .into_iter()
            .filter(|r| r.command != IncludeCommand::IncludeGraphics && r.command != IncludeCommand::Bibliography)
            .filter_map(|r| r.resolved)
            .collect();
        degrees.insert(file.clone(), distinct.len());
    }
    degrees
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/root_detection")).join(name)
    }

    #[cfg(unix)]
    #[test]
    fn self_referential_symlink_does_not_recurse_forever() {
        let dir = std::env::temp_dir().join(format!("quire-root-symlink-cycle-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main.tex"), "\\documentclass{article}\n\\begin{document}x\\end{document}").unwrap();
        std::os::unix::fs::symlink(&dir, dir.join("loop")).unwrap();

        // Must terminate at all -- a symlink cycle used to stack-overflow this walk.
        let files = find_all_tex_files(&dir);
        assert_eq!(files, vec![dir.join("main.tex")]);

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explicit_marker_wins_over_everything_else() {
        let result = detect_root(&fixture("explicit"));
        assert_eq!(result.confidence, RootConfidence::Explicit);
        assert_eq!(result.root, Some(fixture("explicit").join("main.tex")));
    }

    #[test]
    fn single_real_documentclass_is_inferred() {
        let result = detect_root(&fixture("inferred_single"));
        assert_eq!(result.confidence, RootConfidence::Inferred);
        assert_eq!(result.root, Some(fixture("inferred_single").join("main.tex")));
    }

    #[test]
    fn subfiles_documentclass_is_excluded_from_the_single_check() {
        let result = detect_root(&fixture("inferred_subfiles"));
        assert_eq!(result.confidence, RootConfidence::Inferred);
        assert_eq!(result.root, Some(fixture("inferred_subfiles").join("main.tex")));
    }

    #[test]
    fn falls_back_to_the_file_that_includes_the_most_others() {
        let result = detect_root(&fixture("inferred_graph"));
        assert_eq!(result.confidence, RootConfidence::Inferred);
        assert_eq!(result.root, Some(fixture("inferred_graph").join("main.tex")));
    }

    #[test]
    fn genuine_tie_is_ambiguous_with_candidates() {
        let result = detect_root(&fixture("ambiguous"));
        assert_eq!(result.confidence, RootConfidence::Ambiguous);
        assert_eq!(result.root, None);
        assert_eq!(result.candidates.len(), 2, "{:?}", result.candidates);
    }

    #[test]
    fn commented_out_documentclass_does_not_count() {
        let commented_out = strip_comments("% \\documentclass{article}\nplain text");
        assert_eq!(documentclass_name(&commented_out), None);

        let real_one_commented_alternate =
            strip_comments("\\documentclass{article}\n% \\documentclass{report}");
        assert_eq!(documentclass_name(&real_one_commented_alternate), Some("article".to_string()));
    }
}
