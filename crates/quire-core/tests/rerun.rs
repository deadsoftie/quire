// Acceptance test for task 1.6: "Body-only edit does not invoke biber"
// (adapted to classic BibTeX per M1_TASKS.md 1.6's decision -- biber is
// unusable today regardless of rerun scheduling, see the Tectonic/biber BCF
// version-mismatch note there). Uses `.bbl` mtime as the observable signal
// for "did BibTeX actually run," since `compile_latex_in_dir` doesn't
// (yet) surface that as structured output -- real diagnostics are 1.8/
// contract territory.

use std::fs;
use std::path::Path;
use std::time::SystemTime;

use quire_core::rerun::compile_latex_in_dir;

fn bib_fixture_dir() -> &'static str {
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/bibtex")
}

fn fresh_build_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "quire-core-rerun-test-{name}-{}-{}",
        std::process::id(),
        name
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create build dir");
    fs::copy(
        Path::new(bib_fixture_dir()).join("refs.bib"),
        dir.join("refs.bib"),
    )
    .expect("copy refs.bib fixture into build dir");
    dir
}

fn bbl_mtime(dir: &Path) -> Option<SystemTime> {
    fs::metadata(dir.join("texput.bbl"))
        .ok()
        .and_then(|m| m.modified().ok())
}

const SRC_ONE_CITE: &str = r#"
\documentclass{article}
\begin{document}
Hello \cite{knuth1984}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"#;

const SRC_ONE_CITE_BODY_EDITED: &str = r#"
\documentclass{article}
\begin{document}
Hello again, world -- \cite{knuth1984} is a classic.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"#;

const SRC_TWO_CITES: &str = r#"
\documentclass{article}
\begin{document}
Hello \cite{knuth1984} and \cite{lamport1994}.
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"#;

#[test]
fn body_only_edit_does_not_invoke_bibtex() {
    let build_dir = fresh_build_dir("skip");

    let out1 = compile_latex_in_dir(SRC_ONE_CITE, &build_dir).expect("first compile");
    assert!(out1.pdf.starts_with(b"%PDF-"));
    let mtime_after_first = bbl_mtime(&build_dir).expect(".bbl should exist after a compile with citations");

    // Real filesystems commonly have 1s mtime resolution (e.g. HFS+); sleep
    // past that so an unwanted rewrite would actually be observable.
    std::thread::sleep(std::time::Duration::from_millis(1100));

    let out2 = compile_latex_in_dir(SRC_ONE_CITE_BODY_EDITED, &build_dir).expect("body-only edit compile");
    assert!(out2.pdf.starts_with(b"%PDF-"));
    let mtime_after_second = bbl_mtime(&build_dir);

    assert_eq!(
        Some(mtime_after_first),
        mtime_after_second,
        "BibTeX must not rerun when the citation set is unchanged"
    );
}

#[test]
fn new_citation_reruns_bibtex_and_updates_bibliography() {
    let build_dir = fresh_build_dir("rerun");

    compile_latex_in_dir(SRC_ONE_CITE, &build_dir).expect("first compile");
    let mtime_before = bbl_mtime(&build_dir).expect(".bbl should exist");

    std::thread::sleep(std::time::Duration::from_millis(1100));

    let out2 = compile_latex_in_dir(SRC_TWO_CITES, &build_dir).expect("compile with new citation");
    assert!(out2.pdf.starts_with(b"%PDF-"));
    let mtime_after = bbl_mtime(&build_dir);

    assert_ne!(
        Some(mtime_before),
        mtime_after,
        "BibTeX must rerun when the citation set changed"
    );

    let bbl = fs::read_to_string(build_dir.join("texput.bbl")).expect("read .bbl");
    assert!(bbl.contains("Knuth"), "bibliography should include the original citation");
    assert!(bbl.contains("Lamport"), "bibliography should include the newly added citation");
}

#[test]
fn document_without_bibliography_compiles_fine() {
    let build_dir = fresh_build_dir("nobib");
    let source = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

    let out = compile_latex_in_dir(source, &build_dir).expect("compile");
    assert!(out.pdf.starts_with(b"%PDF-"));
    assert!(
        !build_dir.join("texput.bbl").exists(),
        "BibTeX should never run for a document with no bibliography"
    );
}
