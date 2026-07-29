//! Tasks 3.1-3.4's acceptance criteria, end to end: "Cross-file labels complete," "\cite{
//! completes with readable entries," "Custom macros appear with correct tabstops," and "Relative
//! paths complete, extensions filtered by command." Exercises the real `outline`/`complete`
//! handlers (crate::index::ProjectIndex) against multi-file fixtures.

use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::{complete, outline};
use quire_core::rpc::{CompletionItem, CompletionKind, CompletionRequest, OutlineNodeKind, OutlineRequest, Position};

fn copy_dir(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let target = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

fn fresh_project_copy(fixture: &str, name: &str) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(fixture);
    let dst = std::env::temp_dir().join(format!("quire-core-completion-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dst);
    copy_dir(&src, &dst);
    dst
}

/// `Position` right after `needle` (e.g. `"\ref{"`) on the first line containing it -- shared by
/// both the label and citation fixture tests below.
fn position_after(text: &str, needle: &str) -> Position {
    let (line_no, line) = text.lines().enumerate().find(|(_, l)| l.contains(needle)).unwrap();
    let column = (line.find(needle).unwrap() + needle.len()) as u32;
    Position { line: line_no as u32, column }
}

#[test]
fn outline_reports_sections_and_labels_per_file() {
    let project_dir = fresh_project_copy("labels", "outline");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let nodes = outline(&OutlineRequest { project_id, uri: main_uri });

    assert_eq!(nodes.len(), 1, "one top-level section: {nodes:?}");
    assert_eq!(nodes[0].kind, OutlineNodeKind::Section);
    assert_eq!(nodes[0].label, "Introduction");
    assert_eq!(nodes[0].children.len(), 1, "\\ref{{}}/\\input{{}} must not be mistaken for outline entries: {:?}", nodes[0].children);
    assert_eq!(nodes[0].children[0].kind, OutlineNodeKind::Label);
    assert_eq!(nodes[0].children[0].label, "sec:intro");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn ref_completion_includes_labels_defined_in_other_files() {
    let project_dir = fresh_project_copy("labels", "complete-ref");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    let position = position_after(&text, "\\ref{");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text: text.clone() });

    assert!(items.iter().all(|i| i.kind == CompletionKind::Label));
    let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
    assert!(labels.contains(&"sec:results"), "label defined in results.tex (\\input'd from main.tex) should complete: {labels:?}");
    assert!(labels.contains(&"sec:intro"), "same-file label should also complete: {labels:?}");
    assert!(labels.contains(&"sec:details"), "every project label should be in the merged index, not just the directly-referenced one: {labels:?}");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn non_matching_context_returns_no_completions_yet() {
    let project_dir = fresh_project_copy("labels", "complete-noncontext");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();
    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    // Inside \documentclass{article}'s own argument -- an enclosing-command context, but for a
    // command none of ref/eqref/autoref/cite recognize, and not a bare command-name context either
    // (the `{` since the last backslash rules that out). 3.4/3.7/3.8 haven't landed yet regardless.
    let position = position_after(&text, "\\documentclass{art");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text });

    assert!(items.is_empty());

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn macro_completion_merges_newcommand_declaremathoperator_and_def_across_files_with_correct_tabstops() {
    let project_dir = fresh_project_copy("macros", "complete-macro");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    // "using \v" (not just "\v"): line 4 already contains "\v" inside "\newcommand{\vect}" --
    // position_after must land on the actual bare-command-typing line, not that definition line.
    let position = position_after(&text, "using \\v");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text });

    assert!(items.iter().all(|i| i.kind == CompletionKind::Macro));
    let by_label: std::collections::HashMap<&str, &CompletionItem> = items.iter().map(|i| (i.label.as_str(), i)).collect();

    let vect = by_label.get("vect").expect("\\newcommand{\\vect}[1]{...} should complete");
    assert_eq!(vect.insert, "vect{${1:arg1}}");
    assert_eq!(vect.detail.as_deref(), Some("\\mathbf{#1}"));

    let argmax = by_label.get("argmax").expect("\\DeclareMathOperator should complete");
    assert_eq!(argmax.insert, "argmax", "DeclareMathOperator is always arity 0 -- no braces");

    let greet = by_label.get("greet").expect("\\def\\greet#1#2{...} defined in the \\input'd defs.tex should complete across files");
    assert_eq!(greet.insert, "greet{${1:arg1}}{${2:arg2}}");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn cite_completion_reads_the_bib_file_the_bibliography_command_points_at() {
    let project_dir = fresh_project_copy("citations", "complete-cite");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    let position = position_after(&text, "\\cite{");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text: text.clone() });

    assert!(items.iter().all(|i| i.kind == CompletionKind::Citation));
    let by_key: std::collections::HashMap<&str, &CompletionItem> = items.iter().map(|i| (i.label.as_str(), i)).collect();
    assert!(by_key.contains_key("knuth1984") && by_key.contains_key("lamport1994"), "both bib entries should complete: {:?}", by_key.keys());

    let knuth_detail = by_key["knuth1984"].detail.as_deref().unwrap();
    assert_eq!(knuth_detail, "Donald E. Knuth, *The TeXbook*, 1984", "detail must match Section 9.4's literal \"Author, *Title*, Year\" format, case-protection braces stripped");

    let lamport_detail = by_key["lamport1994"].detail.as_deref().unwrap();
    assert!(lamport_detail.starts_with("Lamport, Leslie,"), "an author field's own internal comma (Last, First) must survive intact: {lamport_detail:?}");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn input_completion_offers_tex_files_not_yet_referenced_and_only_tex_files() {
    let project_dir = fresh_project_copy("paths", "complete-input");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    let position = position_after(&text, "\\input{ch");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text });

    assert!(items.iter().all(|i| i.kind == CompletionKind::Path));
    let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
    assert!(labels.contains(&"chapters/intro.tex"), "already-\\input'd files must still complete: {labels:?}");
    assert!(labels.contains(&"chapters/appendix.tex"), "candidates come from a filesystem walk, not just what's already referenced: {labels:?}");
    assert!(!labels.iter().any(|l| l.ends_with(".pdf") || l.ends_with(".png")), "\\input must only offer .tex files: {labels:?}");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn includegraphics_completion_offers_only_image_files() {
    let project_dir = fresh_project_copy("paths", "complete-graphic");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    let position = position_after(&text, "\\includegraphics{fig");

    let items = complete(&CompletionRequest { project_id, uri: main_uri, position, text });

    assert!(items.iter().all(|i| i.kind == CompletionKind::Path));
    let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
    assert!(labels.contains(&"figures/plot.pdf") && labels.contains(&"figures/diagram.png"), "{labels:?}");
    assert!(!labels.iter().any(|l| l.ends_with(".tex")), "\\includegraphics must only offer image files: {labels:?}");

    fs::remove_dir_all(&project_dir).ok();
}
