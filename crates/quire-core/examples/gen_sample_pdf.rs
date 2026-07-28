use std::{fs, path::Path};

fn main() {
    let source = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/hello.tex"
    ))
    .expect("fixture should be readable");

    let pdf = quire_core::compile_latex_to_pdf(&source).expect("compile should succeed");

    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/ui/public/sample.pdf");
    fs::write(&out, &pdf).expect("should write sample pdf");
    println!("wrote {} bytes to {}", pdf.len(), out.display());
}
