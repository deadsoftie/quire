//! Dependency-aware reruns (task 1.6).
//!
//! [`crate::compile_latex`] is a pure, stateless, single-process compile:
//! buffer in, PDF out, nothing persisted anywhere. Tectonic's own automatic
//! multi-pass pipeline (`PassSetting::Default`, which that function uses
//! implicitly) already handles rerunning TeX until `.aux` stabilizes, but it
//! decides whether to run BibTeX purely by checking whether `\bibdata`
//! appears in the current pass's `.aux` -- and `\bibliography{...}` writes
//! `\bibdata` unconditionally on *every* run, regardless of whether the
//! citation set actually changed. So today, any document using BibTeX gets
//! it re-run on every compile, including pure body-text edits. That's what
//! this task exists to fix.
//!
//! Fixing it needs memory of "what were the citations last time," which
//! can't live in process memory: per 1.4's decision, each compile is a
//! fresh OS process (spawn-per-compile, chosen specifically to make
//! cancellation and Tectonic's engine-reuse segfault risk moot), so nothing
//! survives between compiles unless it's on disk. This compiles into a
//! caller-provided directory instead of pure memory, writing real
//! intermediate files (`.aux`, `.bbl`, ...) there so state naturally
//! persists across separate invocations the same way classic
//! latex/bibtex workflows always have -- plus one small fingerprint file of
//! our own (`quire-citations.txt`) to remember the citation set BibTeX last
//! saw, since `\bibdata`'s mere presence isn't enough signal on its own.
//!
//! Bibliography engine: classic BibTeX only (`\bibliography{...}`), not
//! biblatex/biber -- see M1_TASKS.md 1.6 for why (upstream Tectonic/biber
//! BCF version mismatch, tracked as tectonic#1267, makes biber unusable
//! today regardless of rerun scheduling). Tectonic embeds classic BibTeX
//! natively (no external binary), which is also why it's the safer
//! foundation to build this on.
//!
//! Pass budget: max 4 total TeX passes per compile, matching QUIRE_SPEC.md
//! 9.1 (Tectonic's own automatic pipeline defaults to up to 6 with no
//! public way to lower that ceiling while keeping early-exit-on-stability,
//! so this drives passes manually instead of using `PassSetting::Default`).

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
const TEX_INPUT_NAME: &str = "texput.tex";

/// Same compile as [`crate::compile_latex`], but backed by real files in
/// `build_dir` instead of pure in-memory buffers, so repeated calls with the
/// same `build_dir` (i.e. repeated compiles of the same project) can skip
/// BibTeX when the citation set hasn't changed, and only rerun TeX while
/// `.aux` is genuinely still settling.
pub fn compile_latex_in_dir(source: &str, build_dir: &Path) -> Result<CompileOutput, CompileError> {
    fs::create_dir_all(build_dir)?;

    let config = PersistentConfig::open(false)?;
    let format_cache_path = config.format_cache_path()?;
    let aux_path = build_dir.join("texput.aux");

    let aux_before_pass1 = fs::read(&aux_path).unwrap_or_default();
    run_tex_pass(source, build_dir, &config, &format_cache_path)?;
    let mut passes = 1;
    let mut last_aux = fs::read(&aux_path).unwrap_or_default();
    let mut needs_rerun = last_aux != aux_before_pass1;

    let aux_text = String::from_utf8_lossy(&last_aux);
    if let Some(fingerprint) = citation_fingerprint(&aux_text) {
        let fingerprint_path = build_dir.join(CITATION_FINGERPRINT_FILE);
        let previous = fs::read_to_string(&fingerprint_path).ok();
        if previous.as_deref() != Some(fingerprint.as_str()) {
            run_bibtex_pass(build_dir, &config, &format_cache_path)?;
            fs::write(&fingerprint_path, &fingerprint)?;
            // BibTeX doesn't touch .aux (only .bbl), so the aux-diff check
            // above can't see this -- a fresh/changed .bbl always needs at
            // least one more TeX pass to actually get typeset in.
            needs_rerun = true;
        }
    }

    while needs_rerun && passes < MAX_PASSES {
        run_tex_pass(source, build_dir, &config, &format_cache_path)?;
        passes += 1;
        let new_aux = fs::read(&aux_path).unwrap_or_default();
        needs_rerun = new_aux != last_aux;
        last_aux = new_aux;
    }
    // If we ran out of passes and `needs_rerun` is still true, per
    // QUIRE_SPEC.md 9.1 we show the best available output rather than
    // looping or failing -- which is exactly what happens by just falling
    // out of the loop here and reading whatever's on disk below. Surfacing
    // that as a real warning to the user is 1.8/contract territory (no
    // diagnostics channel exists yet); the behavioral requirement (don't
    // loop, don't fail) is satisfied regardless.

    convert_xdv_to_pdf(build_dir, &config)?;

    let pdf = fs::read(build_dir.join("texput.pdf")).map_err(|_| CompileError {
        message: "LaTeX didn't report failure, but no PDF was created".to_string(),
        log: None,
    })?;
    let synctex_gz = fs::read(build_dir.join("texput.synctex.gz")).ok();

    Ok(CompileOutput { pdf, synctex_gz })
}

fn run_tex_pass(
    source: &str,
    build_dir: &Path,
    config: &PersistentConfig,
    format_cache_path: &Path,
) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let bundle = config.default_bundle(false)?;

    let mut sb = ProcessingSessionBuilder::default();
    sb.bundle(bundle)
        .primary_input_buffer(source.as_bytes())
        .tex_input_name(TEX_INPUT_NAME)
        .format_name("latex")
        .format_cache_path(format_cache_path)
        .filesystem_root(build_dir)
        .output_dir(build_dir)
        // Without this, `.aux`'s natural access pattern once a previous
        // pass's copy already exists on disk is read-then-written (LaTeX's
        // kernel `\@input`s the prior `.aux` at `\begin{document}`), and
        // Tectonic's own write_files() silently skips anything that isn't
        // purely `Written` unless this is set -- so `.aux`/`.bbl` would
        // never actually make it to build_dir for the next pass to see.
        .keep_intermediates(true)
        .keep_logs(false)
        .print_stdout(false)
        .synctex(true)
        // Not `Pdf`: `PassSetting::Tex` never runs the XDV->PDF conversion
        // step regardless of `output_format` (that only happens inside the
        // private `default_pass`, which this deliberately avoids -- see
        // `convert_xdv_to_pdf`). Asking for `Xdv` here is just honest about
        // what this pass setting actually produces.
        .output_format(OutputFormat::Xdv)
        .pass(PassSetting::Tex);

    let mut sess = sb.create(&mut status)?;
    if let Err(e) = sess.run(&mut status) {
        let log = String::from_utf8_lossy(&sess.get_stdout_content()).into_owned();
        return Err(CompileError {
            message: e.to_string(),
            log: if log.trim().is_empty() { None } else { Some(log) },
        });
    }

    Ok(())
}

/// Runs BibTeX against whatever `texput.aux` is already sitting in
/// `build_dir` from the most recent [`run_tex_pass`] -- no TeX pass of our
/// own. `PassSetting::BibtexFirst` + `.reruns(0)` gets there: `reruns(0)`
/// forces Tectonic's own internal rerun loop to execute zero times (its
/// `0..pass_count` loop is `0..0`), leaving only the unconditional BibTeX
/// call that `BibtexFirst` always runs first. `OutputFormat::Xdv` (not
/// `Pdf`) matters here too: with no TeX pass, no `.xdv` was produced, so
/// asking for `Pdf` output would trigger a doomed xdvipdfmx conversion
/// pass over a nonexistent file; `Xdv` skips that conversion step entirely
/// while still writing every non-log intermediate (`.bbl` included) to
/// `build_dir` the normal way. (`OutputFormat::Aux` looked promising too,
/// but restricts written files to `.aux` only -- exactly the file `.bbl`
/// isn't.)
fn run_bibtex_pass(
    build_dir: &Path,
    config: &PersistentConfig,
    format_cache_path: &Path,
) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let bundle = config.default_bundle(false)?;

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

/// [`IoProvider`] for the standalone PDF conversion below: `texput.xdv`/
/// `texput.pdf` live in-memory (`mem`), everything else (font files --
/// xdvipdfmx needs to embed e.g. Latin Modern into the PDF, and those come
/// from the TeXLive bundle, not the `.xdv` itself) falls through to the
/// same bundle a real compile uses. `tectonic_bridge_core` ships
/// `MinimalDriver` for the single-provider case, but its wrapped provider
/// is a private field, so there'd be no way to read the converted PDF back
/// out of it afterward -- this is that same one-line `io()` impl, just
/// over fields we can still reach, plus the bundle fallback `MinimalDriver`
/// doesn't support chaining at all.
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

/// Converts `build_dir/texput.xdv` (produced by the last [`run_tex_pass`])
/// into `build_dir/texput.pdf`, standalone -- no `ProcessingSession`
/// involved at all.
///
/// This exists because of a real coupling problem in Tectonic's public API:
/// the XDV->PDF conversion step only ever runs from inside the private
/// `default_pass` (i.e. only reachable via `PassSetting::Default` /
/// `BibtexFirst`), and *both* of those pass settings unconditionally
/// re-run BibTeX whenever `\bibdata` appears in that session's own
/// freshly-generated `.aux` -- which it always does for any real
/// `\bibliography{...}` document, with no way to override the check. So
/// there is no `PassSetting` that both (a) produces a PDF and (b) can ever
/// skip BibTeX. Confirmed directly: `PassSetting::Tex` reliably writes
/// `.xdv` but never touches `.pdf`, no matter what `output_format` is set
/// to. Routing PDF conversion through its own minimal, from-scratch
/// `DriverHooks` (via the public `CoreBridgeLauncher`/`XdvipdfmxEngine`,
/// exported by `tectonic_bridge_core`/`tectonic`) instead of a
/// `ProcessingSession` sidesteps that coupling entirely: no TeX engine
/// involved, and (see [`XdvipdfmxIo`]) only a thin bundle-backed provider
/// for font lookups, not a full session's worth of machinery.
///
/// `texput.xdv`/`texput.pdf` go through `MemoryIo` rather than real files,
/// for a real reason and not just convenience: xdvipdfmx's C side
/// unconditionally opens a "stdout" logging handle on startup
/// (`ttstub_output_open_stdout`, confirmed in `dpx-error.c`) and aborts the
/// whole process if that fails -- a plain `FilesystemIo` doesn't implement
/// `output_open_stdout` at all (it deals in named files, not a stdout
/// concept), where `MemoryIo::new(true)` does.
fn convert_xdv_to_pdf(build_dir: &Path, config: &PersistentConfig) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let xdv = fs::read(build_dir.join("texput.xdv"))?;
    let bundle = config.default_bundle(false)?;

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

/// The parts of `.aux` that determine BibTeX's output: the `\bibdata{...}`
/// line (which `.bib` file(s)) plus every `\citation{...}` line, in the
/// order they appear (order matters for citation-order-dependent
/// bibliography styles like `unsrt`; duplicates from repeated `\cite` of
/// the same key are kept rather than deduplicated, for the same reason --
/// simplest way to never miss a real change). Returns `None` when there's
/// no `\bibdata` at all, meaning this document has no bibliography and
/// BibTeX should never run for it.
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
