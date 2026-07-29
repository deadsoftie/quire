//! Tasks 3.1 and 3.2's acceptance criteria, end to end: "Cross-file labels complete" and "\cite{
//! completes with readable entries." Exercises the real `outline`/`complete` handlers
//! (crate::index::ProjectIndex) against multi-file fixtures.

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
fn non_ref_non_cite_context_returns_no_completions_yet() {
    let project_dir = fresh_project_copy("labels", "complete-noncontext");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();
    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();

    let items = complete(&CompletionRequest {
        project_id,
        uri: main_uri,
        position: Position { line: 0, column: 5 }, // inside \documentclass{, not a \ref/\eqref/\autoref/\cite context
        text,
    });

    assert!(items.is_empty(), "3.3-3.8 haven't landed yet -- only \\ref/\\eqref/\\autoref/\\cite complete today");

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
