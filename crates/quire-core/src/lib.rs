pub mod page_hash;
pub mod project;
pub mod rerun;
pub mod rpc;

use tectonic::driver::{OutputFormat, ProcessingSessionBuilder};
use tectonic::status::NoopStatusBackend;

pub struct CompileOutput {
    pub pdf: Vec<u8>,
    pub page_count: u32,
    /// Always all pages: this call is stateless, so real diffing lives in [`rerun::compile_latex_in_dir`].
    pub changed_pages: Vec<u32>,
}

/// Carries the engine's captured log, unlike `tectonic::Error`'s generic message.
#[derive(Debug)]
pub struct CompileError {
    pub message: String,
    pub log: Option<String>,
}

impl std::fmt::Display for CompileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for CompileError {}

impl From<tectonic::Error> for CompileError {
    fn from(e: tectonic::Error) -> Self {
        CompileError {
            message: e.to_string(),
            log: None,
        }
    }
}

impl From<std::io::Error> for CompileError {
    fn from(e: std::io::Error) -> Self {
        CompileError {
            message: e.to_string(),
            log: None,
        }
    }
}

pub fn compile_latex_to_pdf(source: &str) -> Result<Vec<u8>, CompileError> {
    compile_latex(source).map(|out| out.pdf)
}

/// Same as [`compile_latex_to_pdf`] but returns the full [`CompileOutput`].
pub fn compile_latex(source: &str) -> Result<CompileOutput, CompileError> {
    let mut status = NoopStatusBackend::default();

    let config = tectonic::config::PersistentConfig::open(false)?;
    let bundle = config.default_bundle(false)?;
    let format_cache_path = config.format_cache_path()?;

    let mut sb = ProcessingSessionBuilder::default();
    sb.bundle(bundle)
        .primary_input_buffer(source.as_bytes())
        .tex_input_name("texput.tex")
        .format_name("latex")
        .format_cache_path(format_cache_path)
        .keep_logs(false)
        .keep_intermediates(false)
        .print_stdout(false)
        .output_format(OutputFormat::Pdf)
        .do_not_write_output_files();

    let mut sess = sb.create(&mut status)?;

    if let Err(e) = sess.run(&mut status) {
        let log = String::from_utf8_lossy(&sess.get_stdout_content()).into_owned();
        return Err(CompileError {
            message: e.to_string(),
            log: if log.trim().is_empty() { None } else { Some(log) },
        });
    }

    let mut files = sess.into_file_data();

    let pdf = files.remove("texput.pdf").map(|f| f.data).ok_or_else(|| CompileError {
        message: "LaTeX didn't report failure, but no PDF was created".to_string(),
        log: None,
    })?;

    let page_count = page_hash::hash_pages(&pdf)?.len() as u32;
    let changed_pages = (1..=page_count).collect();

    Ok(CompileOutput { pdf, page_count, changed_pages })
}
