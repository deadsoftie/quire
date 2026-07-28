pub fn compile_latex_to_pdf(source: &str) -> Result<Vec<u8>, tectonic::Error> {
    tectonic::latex_to_pdf(source)
}
