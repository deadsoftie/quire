use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::compile;
use quire_core::rpc::{CompileEngine, CompileReason, CompileRequest, Diagnostic, DirtyBuffer, Severity};

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
    let dst = std::env::temp_dir().join(format!("quire-core-diagnostics-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dst);
    copy_dir(&src, &dst);
    dst
}

fn wrap(body: &str) -> String {
    format!("\\documentclass{{article}}\n\\begin{{document}}\n{body}\n\\end{{document}}\n")
}

/// Compiles `body` as the root document's dirty-buffer content -- no fixture per test case needed.
fn diagnostics_for(name: &str, body: &str) -> Vec<Diagnostic> {
    let project_dir = fresh_project_copy(name);
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let resp = compile(&CompileRequest {
        project_id,
        dirty_buffers: vec![DirtyBuffer { uri: main_uri, text: wrap(body) }],
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should not error at the RPC level");

    fs::remove_dir_all(&project_dir).ok();
    resp.diagnostics
}

fn find<'a>(diags: &'a [Diagnostic], code: &str) -> &'a Diagnostic {
    diags.iter().find(|d| d.code.as_deref() == Some(code)).unwrap_or_else(|| panic!("no {code:?} diagnostic in {diags:?}"))
}

#[test]
fn missing_dollar_is_translated() {
    let diags = diagnostics_for("missing-dollar", "Look at x^2 here.");
    let d = find(&diags, "missing-dollar");
    assert_eq!(d.severity, Severity::Error);
    assert_eq!(d.message, "Math symbol used outside math mode");
    assert!(d.raw_message.contains("Missing $ inserted"));
    assert!(d.hint.is_some());
    assert!(d.uri.as_deref().unwrap().ends_with("main.tex"));
    assert_eq!(d.range.as_ref().unwrap().start.line, 2, "0-based line for source line 3");
}

#[test]
fn undefined_command_is_translated_and_names_the_command() {
    let diags = diagnostics_for("undefined-command", "\\foobarbaz");
    let d = find(&diags, "undefined-command");
    assert_eq!(d.message, "\\foobarbaz isn't a command LaTeX knows");
    assert!(d.raw_message.contains("Undefined control sequence"));
}

#[test]
fn missing_package_is_translated_and_names_the_package() {
    let project_dir = fresh_project_copy("missing-package");
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();
    let source = "\\documentclass{article}\n\\usepackage{thisdoesnotexistxyz}\n\\begin{document}\nx\n\\end{document}\n";

    let resp = compile(&CompileRequest {
        project_id,
        dirty_buffers: vec![DirtyBuffer { uri: main_uri, text: source.to_string() }],
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .unwrap();
    fs::remove_dir_all(&project_dir).ok();

    let d = find(&resp.diagnostics, "missing-package");
    assert_eq!(d.message, "The thisdoesnotexistxyz package isn't installed");
    assert!(d.hint.as_deref().unwrap().to_lowercase().contains("download"));
}

#[test]
fn runaway_arg_is_translated() {
    let diags = diagnostics_for("runaway-arg", "\\textbf{unterminated");
    let d = find(&diags, "runaway-arg");
    assert!(d.message.contains("\\textbf"));
}

#[test]
fn env_mismatch_names_both_environments() {
    let diags = diagnostics_for("env-mismatch", "\\begin{itemize}\n\\item x\n\\end{enumerate}");
    let d = find(&diags, "env-mismatch");
    assert_eq!(d.message, "Environment opened as itemize, closed as enumerate");
}

#[test]
fn overfull_hbox_over_5pt_is_reported_as_a_warning() {
    let diags = diagnostics_for("overfull-big", "\\hbox to 1pt{this is a much much much longer piece of text}");
    let d = find(&diags, "overfull-hbox");
    assert_eq!(d.severity, Severity::Warning);
    assert!(d.message.contains("pt"));
}

#[test]
fn overfull_hbox_under_5pt_is_suppressed() {
    let diags = diagnostics_for("overfull-small", "\\hbox to 200pt{x}");
    assert!(
        !diags.iter().any(|d| d.code.as_deref() == Some("overfull-hbox")),
        "a small overfull box must not reach the user: {diags:?}"
    );
}

#[test]
fn undefined_citation_names_the_key() {
    let diags = diagnostics_for("undefined-citation", "\\cite{doesnotexist2024}");
    let d = find(&diags, "undefined-citation");
    assert_eq!(d.severity, Severity::Warning);
    assert!(d.message.contains("doesnotexist2024"));
}

#[test]
fn undefined_reference_names_the_label() {
    let diags = diagnostics_for("undefined-reference", "See \\ref{doesnotexist} there.");
    let d = find(&diags, "undefined-reference");
    assert_eq!(d.severity, Severity::Warning);
    assert!(d.message.contains("doesnotexist"));
}

#[test]
fn rerun_needed_has_no_location_but_is_still_reported() {
    let diags = diagnostics_for("rerun-needed", "\\cite{doesnotexist2024}");
    let d = find(&diags, "rerun-needed");
    assert_eq!(d.uri, None);
    assert_eq!(d.range, None);
}

#[test]
fn extra_tab_is_translated() {
    let diags = diagnostics_for("extra-tab", "\\begin{tabular}{c}\na & b \\\\\n\\end{tabular}");
    let d = find(&diags, "extra-tab");
    assert_eq!(d.message, "Row has more & columns than the table declares");
}

#[test]
fn undefined_environment_names_the_environment() {
    let diags = diagnostics_for("undefined-environment", "\\begin{nosuchenv}\nx\n\\end{nosuchenv}");
    let d = find(&diags, "undefined-environment");
    assert_eq!(d.message, "The nosuchenv environment isn't defined");
}

#[test]
fn a_clean_compile_has_no_diagnostics() {
    let diags = diagnostics_for("clean", "Nothing wrong here.");
    assert!(diags.is_empty(), "{diags:?}");
}

#[test]
fn every_diagnostic_carries_a_code_and_a_hint() {
    let diags = diagnostics_for("shape-check", "\\foobarbaz");
    assert!(!diags.is_empty());
    for d in &diags {
        assert!(d.code.is_some(), "{d:?}");
        assert!(d.hint.is_some(), "{d:?}");
        assert!(!d.message.is_empty());
        assert!(!d.raw_message.is_empty());
    }
}
