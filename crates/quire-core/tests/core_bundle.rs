//! Verifies the curated bundle in `bundles/core/` (built by the `build_core_bundle` example from
//! `bundles/manifest.json`) actually covers the six core_bundle_discovery fixtures on its own --
//! the closest thing to task 4.1's "four templates compile fully offline" acceptance criterion
//! available before real templates exist. Fixtures are re-run through the discovery example
//! whenever they change (see bundles/README.md), so this just has to keep passing against
//! whatever the current bundle contains.

use std::fs;
use std::path::PathBuf;

use quire_core::bundle::resolve_bundle;
use quire_core::rerun::compile_latex_in_dir_with_bundle;

fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/examples/fixtures/core_bundle_discovery"))
}

fn compile_fixture(name: &str, extra_files: &[&str]) {
    assert!(
        core_bundle_dir().join("SHA256SUM").is_file(),
        "bundles/core/SHA256SUM missing -- run `cargo run -p quire-core --example build_core_bundle` \
         first, otherwise this test would silently fall back to the network bundle"
    );

    let source = fs::read_to_string(fixtures_dir().join(name))
        .unwrap_or_else(|e| panic!("reading fixture {name}: {e}"));

    let build_dir = std::env::temp_dir().join(format!(
        "quire-core-core-bundle-test-{}-{}",
        name.trim_end_matches(".tex"),
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&build_dir);
    fs::create_dir_all(&build_dir).expect("create build dir");
    for extra in extra_files {
        fs::copy(fixtures_dir().join(extra), build_dir.join(extra))
            .unwrap_or_else(|e| panic!("copying fixture dependency {extra}: {e}"));
    }

    let result = compile_latex_in_dir_with_bundle(&source, &build_dir, &resolve_bundle);
    let _ = fs::remove_dir_all(&build_dir);

    let out = result.unwrap_or_else(|e| panic!("compiling {name}: {}", e.log.as_deref().unwrap_or(&e.message)));
    assert!(out.pdf.starts_with(b"%PDF-"), "{name}: output should start with the PDF magic bytes");
}

#[test]
fn article_compiles_against_core_bundle() {
    compile_fixture("article.tex", &["article_refs.bib"]);
}

#[test]
fn report_compiles_against_core_bundle() {
    compile_fixture("report.tex", &[]);
}

#[test]
fn book_compiles_against_core_bundle() {
    compile_fixture("book.tex", &[]);
}

#[test]
fn beamer_compiles_against_core_bundle() {
    compile_fixture("beamer.tex", &[]);
}

#[test]
fn ieee_compiles_against_core_bundle() {
    compile_fixture("ieee.tex", &[]);
}

#[test]
fn acm_compiles_against_core_bundle() {
    compile_fixture("acm.tex", &[]);
}
