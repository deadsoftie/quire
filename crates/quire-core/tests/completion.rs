//! Task 3.1's acceptance criterion, end to end: "Cross-file labels complete." Exercises the real
//! `outline`/`complete` handlers (crate::index::ProjectIndex) against a multi-file fixture,
//! proving a label defined in one file completes while editing `\ref{` in a different file.

use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::{complete, outline};
use quire_core::rpc::{CompletionRequest, OutlineNodeKind, OutlineRequest, Position};

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

fn fresh_project_copy(name: &str) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/labels");
    let dst = std::env::temp_dir().join(format!("quire-core-completion-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dst);
    copy_dir(&src, &dst);
    dst
}

#[test]
fn outline_reports_sections_and_labels_per_file() {
    let project_dir = fresh_project_copy("outline");
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
    let project_dir = fresh_project_copy("complete");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    let (line_no, ref_line) = text.lines().enumerate().find(|(_, l)| l.contains("\\ref{sec:results}")).unwrap();
    let column = (ref_line.find("\\ref{").unwrap() + "\\ref{".len()) as u32;

    let items = complete(&CompletionRequest {
        project_id,
        uri: main_uri,
        position: Position { line: line_no as u32, column },
        text: text.clone(),
    });

    let labels: Vec<&str> = items.iter().map(|i| i.label.as_str()).collect();
    assert!(labels.contains(&"sec:results"), "label defined in results.tex (\\input'd from main.tex) should complete: {labels:?}");
    assert!(labels.contains(&"sec:intro"), "same-file label should also complete: {labels:?}");
    assert!(labels.contains(&"sec:details"), "every project label should be in the merged index, not just the directly-referenced one: {labels:?}");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn non_ref_context_returns_no_completions_yet() {
    let project_dir = fresh_project_copy("complete-noncontext");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();
    let text = fs::read_to_string(project_dir.join("main.tex")).unwrap();

    let items = complete(&CompletionRequest {
        project_id,
        uri: main_uri,
        position: Position { line: 0, column: 5 }, // inside \documentclass{, not a \ref/\eqref/\autoref context
        text,
    });

    assert!(items.is_empty(), "3.2-3.8 haven't landed yet -- only \\ref/\\eqref/\\autoref completes today");

    fs::remove_dir_all(&project_dir).ok();
}
