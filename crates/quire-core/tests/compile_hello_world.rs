use std::fs;

#[test]
fn compiles_hello_world_to_pdf() {
    let source = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/hello.tex"
    ))
    .expect("fixture should be readable");

    let pdf = quire_core::compile_latex_to_pdf(&source).expect("compile should succeed");

    assert!(pdf.starts_with(b"%PDF-"), "output should start with the PDF magic bytes");
    assert!(pdf.len() > 100, "output should be a non-trivial PDF");
}
