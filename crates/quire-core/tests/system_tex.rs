//! Runs for real against whatever system TeX install exists; a machine with no install just skips these tests rather than failing.

use std::fs;
use std::path::Path;

use quire_core::system_tex;

fn bib_fixture_dir() -> &'static str {
    concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/bibtex")
}

fn fresh_build_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("quire-core-system-tex-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create build dir");
    fs::copy(Path::new(bib_fixture_dir()).join("refs.bib"), dir.join("refs.bib")).expect("copy refs.bib fixture");
    dir
}

const SRC_ONE_CITE: &str = r#"
\documentclass{article}
\begin{document}
Hello \cite{knuth1984}.
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
fn detect_finds_a_real_working_install_on_this_machine() {
    let Some((_engine, version)) = system_tex::detect() else {
        eprintln!("skipping: no system TeX install detected on this machine");
        return;
    };
    assert!(!version.is_empty(), "a detected install should report a real version string");
}

#[test]
fn compiles_end_to_end_with_a_bibtex_rerun_via_subprocess() {
    let Some((engine, _)) = system_tex::detect() else {
        eprintln!("skipping: no system TeX install detected on this machine");
        return;
    };

    let build_dir = fresh_build_dir("rerun");
    fs::write(build_dir.join("main.tex"), SRC_ONE_CITE).expect("write main.tex");

    let out1 = system_tex::compile(engine, Path::new("main.tex"), &build_dir).expect("first compile");
    assert!(out1.pdf.starts_with(b"%PDF-"), "first pass should produce a real PDF");
    assert!(build_dir.join("texput.bbl").is_file(), "a citation should have triggered a real bibtex subprocess run");

    // A second compile with a new citation exercises the BibTeX-rerun branch of the shared rerun loop.
    fs::write(build_dir.join("main.tex"), SRC_TWO_CITES).expect("rewrite main.tex");
    let out2 = system_tex::compile(engine, Path::new("main.tex"), &build_dir).expect("second compile");
    assert!(out2.pdf.starts_with(b"%PDF-"));

    let bbl = fs::read_to_string(build_dir.join("texput.bbl")).expect("read .bbl");
    assert!(bbl.contains("Knuth"), "bibliography should include the original citation");
    assert!(bbl.contains("Lamport"), "bibliography should include the newly added citation");

    let _ = fs::remove_dir_all(&build_dir);
}

#[test]
fn compiles_a_document_with_no_bibliography_fine() {
    let Some((engine, _)) = system_tex::detect() else {
        eprintln!("skipping: no system TeX install detected on this machine");
        return;
    };

    let build_dir = fresh_build_dir("nobib");
    let source = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";
    fs::write(build_dir.join("main.tex"), source).expect("write main.tex");

    let out = system_tex::compile(engine, Path::new("main.tex"), &build_dir).expect("compile");
    assert!(out.pdf.starts_with(b"%PDF-"));
    assert!(!build_dir.join("texput.bbl").exists(), "bibtex should never run for a document with no bibliography");

    let _ = fs::remove_dir_all(&build_dir);
}
