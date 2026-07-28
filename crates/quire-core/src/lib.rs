pub mod project;
pub mod synctex;

use tectonic::driver::{OutputFormat, ProcessingSessionBuilder};
use tectonic::status::NoopStatusBackend;

pub struct CompileOutput {
    pub pdf: Vec<u8>,
    /// Raw gzip-compressed bytes, exactly as Tectonic writes them.
    pub synctex_gz: Option<Vec<u8>>,
}

/// Unlike `tectonic::Error` (whose `Display` is often just a generic
/// "the LaTeX engine failed"), this carries the engine's actual captured
/// log output when available, so failures are diagnosable instead of
/// opaque.
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

pub fn compile_latex_to_pdf(source: &str) -> Result<Vec<u8>, CompileError> {
    compile_latex(source).map(|out| out.pdf)
}

/// Same underlying session as [`compile_latex_to_pdf`], but with SyncTeX
/// enabled and both output files captured instead of just the PDF.
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
        .synctex(true)
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
    let synctex_gz = files.remove("texput.synctex.gz").map(|f| f.data);

    Ok(CompileOutput { pdf, synctex_gz })
}
