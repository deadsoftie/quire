use std::fs;
use std::path::Path;

use tectonic::config::PersistentConfig;
use tectonic::driver::{OutputFormat, PassSetting, ProcessingSessionBuilder};
use tectonic::io::{InputHandle, IoProvider, MemoryIo, OpenResult, OutputHandle};
use tectonic::status::{NoopStatusBackend, StatusBackend};
use tectonic_bridge_core::{CoreBridgeLauncher, DriverHooks};
use tectonic_bundles::Bundle;
use tectonic_engine_xdvipdfmx::XdvipdfmxEngine;

use crate::{CompileError, CompileOutput};

const MAX_PASSES: usize = 4;
const CITATION_FINGERPRINT_FILE: &str = "quire-citations.txt";
const PAGE_HASHES_FILE: &str = "quire-page-hashes.txt";
const TEX_INPUT_NAME: &str = "texput.tex";

/// Factory rather than a plain `Box<dyn Bundle>` because each Tectonic pass needs its own
/// fresh bundle instance -- `ProcessingSessionBuilder::bundle` consumes it.
pub type BundleFactory = dyn Fn() -> Result<Box<dyn Bundle>, CompileError>;

pub fn compile_latex_in_dir(source: &str, build_dir: &Path) -> Result<CompileOutput, CompileError> {
    compile_latex_in_dir_with_bundle(source, build_dir, &crate::bundle::resolve_bundle)
}

pub fn compile_latex_in_dir_with_bundle(
    source: &str,
    build_dir: &Path,
    bundle_factory: &BundleFactory,
) -> Result<CompileOutput, CompileError> {
    fs::create_dir_all(build_dir)?;

    let config = PersistentConfig::open(false)?;
    let format_cache_path = config.format_cache_path()?;
    let aux_path = build_dir.join("texput.aux");

    let aux_before_pass1 = fs::read(&aux_path).unwrap_or_default();
    let mut last_log = run_tex_pass(source, build_dir, &format_cache_path, bundle_factory)?;
    let mut passes = 1;
    let mut last_aux = fs::read(&aux_path).unwrap_or_default();
    let mut needs_rerun = last_aux != aux_before_pass1;

    let aux_text = String::from_utf8_lossy(&last_aux);
    if let Some(fingerprint) = citation_fingerprint(&aux_text) {
        let fingerprint_path = build_dir.join(CITATION_FINGERPRINT_FILE);
        let previous = fs::read_to_string(&fingerprint_path).ok();
        if previous.as_deref() != Some(fingerprint.as_str()) {
            run_bibtex_pass(build_dir, &format_cache_path, bundle_factory)?;
            fs::write(&fingerprint_path, &fingerprint)?;
            // BibTeX only touches .bbl, invisible to the aux-diff check above.
            needs_rerun = true;
        }
    }

    while needs_rerun && passes < MAX_PASSES {
        last_log = run_tex_pass(source, build_dir, &format_cache_path, bundle_factory)?;
        passes += 1;
        let new_aux = fs::read(&aux_path).unwrap_or_default();
        needs_rerun = new_aux != last_aux;
        last_aux = new_aux;
    }
    convert_xdv_to_pdf(build_dir, bundle_factory)?;

    let pdf = fs::read(build_dir.join("texput.pdf")).map_err(|_| CompileError {
        message: "LaTeX didn't report failure, but no PDF was created".to_string(),
        log: None,
    })?;

    let hashes = crate::page_hash::hash_pages(&pdf)?;
    let hashes_path = build_dir.join(PAGE_HASHES_FILE);
    let previous_hashes: Option<Vec<String>> =
        fs::read_to_string(&hashes_path).ok().map(|s| s.lines().map(str::to_string).collect());
    let changed_pages = crate::page_hash::diff_pages(previous_hashes.as_deref(), &hashes);
    fs::write(&hashes_path, hashes.join("\n"))?;

    Ok(CompileOutput { pdf, page_count: hashes.len() as u32, changed_pages, log: last_log })
}

fn run_tex_pass(
    source: &str,
    build_dir: &Path,
    format_cache_path: &Path,
    bundle_factory: &BundleFactory,
) -> Result<String, CompileError> {
    let mut status = NoopStatusBackend::default();
    let bundle = bundle_factory()?;

    let mut sb = ProcessingSessionBuilder::default();
    sb.bundle(bundle)
        .primary_input_buffer(source.as_bytes())
        .tex_input_name(TEX_INPUT_NAME)
        .format_name("latex")
        .format_cache_path(format_cache_path)
        .filesystem_root(build_dir)
        .output_dir(build_dir)
        // Required or Tectonic silently skips writing back a read-then-written .aux/.bbl (LaTeX re-\@inputs the prior .aux).
        .keep_intermediates(true)
        .keep_logs(false)
        .print_stdout(false)
        // PassSetting::Tex never converts XDV->PDF regardless of output_format -- see convert_xdv_to_pdf.
        .output_format(OutputFormat::Xdv)
        .pass(PassSetting::Tex);

    let mut sess = sb.create(&mut status)?;
    let result = sess.run(&mut status);
    // Unlike lib.rs's do_not_write_output_files() path, this builder config keeps a full
    // transcript in get_stdout_content() on success too, for diagnostics::translate_log.
    let log = String::from_utf8_lossy(&sess.get_stdout_content()).into_owned();

    if let Err(e) = result {
        return Err(CompileError { message: e.to_string(), log: if log.trim().is_empty() { None } else { Some(log) } });
    }

    Ok(log)
}

fn run_bibtex_pass(
    build_dir: &Path,
    format_cache_path: &Path,
    bundle_factory: &BundleFactory,
) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let bundle = bundle_factory()?;

    let mut sb = ProcessingSessionBuilder::default();
    sb.bundle(bundle)
        .primary_input_buffer(&[])
        .tex_input_name(TEX_INPUT_NAME)
        .format_name("latex")
        .format_cache_path(format_cache_path)
        .filesystem_root(build_dir)
        .output_dir(build_dir)
        .keep_intermediates(true)
        .keep_logs(false)
        .print_stdout(false)
        .output_format(OutputFormat::Xdv)
        .pass(PassSetting::BibtexFirst)
        .reruns(0);

    let mut sess = sb.create(&mut status)?;
    if let Err(e) = sess.run(&mut status) {
        let log = String::from_utf8_lossy(&sess.get_stdout_content()).into_owned();
        return Err(CompileError {
            message: format!("BibTeX failed: {e}"),
            log: if log.trim().is_empty() { None } else { Some(log) },
        });
    }

    Ok(())
}

struct XdvipdfmxIo {
    mem: MemoryIo,
    bundle: Box<dyn Bundle>,
}

impl IoProvider for XdvipdfmxIo {
    fn output_open_name(&mut self, name: &str) -> OpenResult<OutputHandle> {
        self.mem.output_open_name(name)
    }

    fn output_open_stdout(&mut self) -> OpenResult<OutputHandle> {
        self.mem.output_open_stdout()
    }

    fn input_open_name(&mut self, name: &str, status: &mut dyn StatusBackend) -> OpenResult<InputHandle> {
        match self.mem.input_open_name(name, status) {
            OpenResult::NotAvailable => self.bundle.input_open_name(name, status),
            other => other,
        }
    }
}

struct XdvipdfmxDriver(XdvipdfmxIo);

impl DriverHooks for XdvipdfmxDriver {
    fn io(&mut self) -> &mut dyn IoProvider {
        &mut self.0
    }
}

fn convert_xdv_to_pdf(build_dir: &Path, bundle_factory: &BundleFactory) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let xdv = fs::read(build_dir.join("texput.xdv"))?;
    let bundle = bundle_factory()?;

    let mut mem = MemoryIo::new(true);
    mem.create_entry("texput.xdv", xdv);
    let mut driver = XdvipdfmxDriver(XdvipdfmxIo { mem, bundle });

    {
        let mut launcher = CoreBridgeLauncher::new(&mut driver, &mut status);
        XdvipdfmxEngine::default()
            .process(&mut launcher, "texput.xdv", "texput.pdf")
            .map_err(|e| CompileError {
                message: format!("xdvipdfmx failed: {e}"),
                log: None,
            })?;
    }

    let pdf = driver
        .0
        .mem
        .files
        .borrow_mut()
        .remove("texput.pdf")
        .map(|f| f.data)
        .ok_or_else(|| CompileError {
            message: "xdvipdfmx did not report failure, but no PDF was created".to_string(),
            log: None,
        })?;
    fs::write(build_dir.join("texput.pdf"), pdf)?;

    Ok(())
}

fn citation_fingerprint(aux_text: &str) -> Option<String> {
    let mut has_bibdata = false;
    let mut lines = Vec::new();

    for line in aux_text.lines() {
        if line.starts_with("\\bibdata{") {
            has_bibdata = true;
            lines.push(line);
        } else if line.starts_with("\\citation{") {
            lines.push(line);
        }
    }

    has_bibdata.then(|| lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_bibdata_means_no_fingerprint() {
        let aux = "\\relax\n\\newlabel{sec:intro}{{1}{1}}\n";
        assert_eq!(citation_fingerprint(aux), None);
    }

    #[test]
    fn bibdata_alone_still_fingerprints() {
        let aux = "\\bibstyle{plain}\n\\bibdata{refs}\n";
        assert_eq!(citation_fingerprint(aux), Some("\\bibdata{refs}".to_string()));
    }

    #[test]
    fn same_citations_same_fingerprint() {
        let a = "\\bibdata{refs}\n\\citation{knuth1984}\n\\citation{lamport1994}\n";
        let b = "\\bibdata{refs}\n\\citation{knuth1984}\n\\citation{lamport1994}\n";
        assert_eq!(citation_fingerprint(a), citation_fingerprint(b));
    }

    #[test]
    fn new_citation_changes_fingerprint() {
        let a = "\\bibdata{refs}\n\\citation{knuth1984}\n";
        let b = "\\bibdata{refs}\n\\citation{knuth1984}\n\\citation{lamport1994}\n";
        assert_ne!(citation_fingerprint(a), citation_fingerprint(b));
    }

    #[test]
    fn reordering_changes_fingerprint() {
        let a = "\\bibdata{refs}\n\\citation{a}\n\\citation{b}\n";
        let b = "\\bibdata{refs}\n\\citation{b}\n\\citation{a}\n";
        assert_ne!(citation_fingerprint(a), citation_fingerprint(b));
    }
}
