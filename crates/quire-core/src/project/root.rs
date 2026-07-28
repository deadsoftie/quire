use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::{parse_references, strip_comments, IncludeCommand, SKIP_NAMES};

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
    /// Populated when ambiguous (per the contract, Section 6).
    pub candidates: Vec<PathBuf>,
}

/// Detects a project's root document, in the order the spec lays out:
/// an explicit `% !TEX root = ...` comment, else a single file with a
/// real (non-`subfiles`) `\documentclass`, else the file that includes
/// the most other files, else ambiguous.
pub fn detect_root(project_dir: &Path) -> RootDetectionResult {
    let tex_files = find_all_tex_files(project_dir);

    if let Some(root) = detect_explicit(&tex_files) {
        return RootDetectionResult {
            root: Some(root),
            confidence: RootConfidence::Explicit,
            candidates: Vec::new(),
        };
    }

    let documentclass_files = files_with_real_documentclass(&tex_files);
    if documentclass_files.len() == 1 {
        return RootDetectionResult {
            root: Some(documentclass_files[0].clone()),
            confidence: RootConfidence::Inferred,
            candidates: Vec::new(),
        };
    }

    // Ambiguous at the documentclass level (zero or several candidates) --
    // fall back to whichever file includes the most others. This is the
    // spec table's "most-included file"; read literally that's passive
    // ("the file most often included BY others"), but that would tend to
    // pick a shared macros/preamble file every chapter \input's, not the
    // root. A project's actual root is the one that DOES the including
    // (the highest \input/\include/\subfile out-degree), which is the
    // interpretation implemented here -- flag this if it turns out wrong
    // against real projects.
    let search_scope: Vec<PathBuf> = if documentclass_files.is_empty() {
        tex_files.clone()
    } else {
        documentclass_files
    };

    let out_degrees = compute_out_degrees(&search_scope, project_dir);
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
    let mut results = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return results;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if SKIP_NAMES.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            results.extend(find_all_tex_files(&path));
        } else if path.extension().is_some_and(|e| e == "tex") {
            results.push(path);
        }
    }
    results
}

/// `% !TEX root = <path>` (TeXShop/TeXWorks convention), path relative to
/// the file containing the comment -- that file is saying "when you edit
/// me, actually compile this instead." Scans every file in the project;
/// if the (possibly several) markers found all resolve to the same file,
/// that's the explicit root. Disagreeing markers don't count as explicit
/// -- better to fall through to inference than confidently pick wrong.
fn detect_explicit(tex_files: &[PathBuf]) -> Option<PathBuf> {
    let mut resolved: HashSet<PathBuf> = HashSet::new();

    for file in tex_files {
        let Ok(content) = fs::read_to_string(file) else { continue };
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

/// Files with a `\documentclass` whose class is *not* `subfiles`. Each
/// chapter in a `subfiles`-based project (e.g. `\documentclass[main]{subfiles}`)
/// also has its own `\documentclass` line -- confirmed directly against
/// the real paper used for the 0.9 gate test, where every chapter file
/// had one. Counting those as documentclass candidates would make a
/// subfiles project always look ambiguous at this step, when the real
/// root (using an actual document class) is usually unambiguous.
///
/// Comments are stripped first (same as 1.1's reference parsing) so a
/// commented-out `\documentclass{...}` -- a real thing people leave in
/// documents when trying an alternate class -- doesn't get counted.
fn files_with_real_documentclass(tex_files: &[PathBuf]) -> Vec<PathBuf> {
    tex_files
        .iter()
        .filter(|f| {
            fs::read_to_string(f)
                .ok()
                .map(|content| strip_comments(&content))
                .and_then(|content| documentclass_name(&content))
                .is_some_and(|name| name != "subfiles")
        })
        .cloned()
        .collect()
}

fn documentclass_name(content: &str) -> Option<String> {
    let idx = content.find("\\documentclass")?;
    let rest = &content[idx + "\\documentclass".len()..];
    // Skip an optional [options] block.
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

fn compute_out_degrees(files: &[PathBuf], project_dir: &Path) -> HashMap<PathBuf, usize> {
    let mut degrees = HashMap::new();
    for file in files {
        let Ok(content) = fs::read_to_string(file) else {
            degrees.insert(file.clone(), 0);
            continue;
        };
        let refs = parse_references(&content, project_dir);
        let distinct: HashSet<PathBuf> = refs
            .into_iter()
            .filter(|r| r.command != IncludeCommand::IncludeGraphics)
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
        // documentclass_name itself has no comment awareness -- callers
        // (files_with_real_documentclass) strip comments first. Test that
        // combination, not the raw function in isolation, since testing
        // it alone would just prove it doesn't strip comments, not that
        // detection overall handles them.
        let commented_out = strip_comments("% \\documentclass{article}\nplain text");
        assert_eq!(documentclass_name(&commented_out), None);

        let real_one_commented_alternate =
            strip_comments("\\documentclass{article}\n% \\documentclass{report}");
        assert_eq!(documentclass_name(&real_one_commented_alternate), Some("article".to_string()));
    }
}
