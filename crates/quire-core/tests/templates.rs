//! Proves each shipped template compiles clean against the curated core bundle, nothing installed on demand.

use std::fs;
use std::path::PathBuf;

use quire_core::bundle::resolve_bundle;
use quire_core::rerun::compile_latex_in_dir_with_bundle;

fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

fn templates_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../templates"))
}

fn compile_template(name: &str) {
    assert!(
        core_bundle_dir().join("SHA256SUM").is_file(),
        "bundles/core/SHA256SUM missing -- run `cargo run -p quire-core --example build_core_bundle` \
         first, otherwise this test would silently fall back to the network bundle"
    );

    let source = fs::read_to_string(templates_dir().join(name)).unwrap_or_else(|e| panic!("reading template {name}: {e}"));

    let build_dir = std::env::temp_dir().join(format!("quire-core-templates-test-{}-{}", name.trim_end_matches(".tex"), std::process::id()));
    let _ = fs::remove_dir_all(&build_dir);
    fs::create_dir_all(&build_dir).expect("create build dir");

    let result = compile_latex_in_dir_with_bundle(&source, &build_dir, &resolve_bundle);
    let _ = fs::remove_dir_all(&build_dir);

    let out = result.unwrap_or_else(|e| panic!("compiling {name}: {}", e.log.as_deref().unwrap_or(&e.message)));
    assert!(out.pdf.starts_with(b"%PDF-"), "{name}: output should start with the PDF magic bytes");
}

#[test]
fn article_template_compiles_clean_against_core() {
    compile_template("article.tex");
}

#[test]
fn ieee_template_compiles_clean_against_core() {
    compile_template("ieee.tex");
}

#[test]
fn acm_template_compiles_clean_against_core() {
    compile_template("acm.tex");
}

#[test]
fn beamer_template_compiles_clean_against_core() {
    compile_template("beamer.tex");
}
