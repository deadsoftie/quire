//! Task 4.9: an opt-in fallback that shells out to a system TeX Live/MiKTeX install instead of
//! the embedded, in-process Tectonic -- the one place in this crate that spawns a subprocess at
//! all, and (per D5) the one code path that can never exist on the future iPad build.

use std::fs;
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

use crate::rpc::SystemTexEngine;
use crate::{CompileError, CompileOutput};

const PASS_TIMEOUT: Duration = Duration::from_secs(120);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Xelatex,
    Pdflatex,
}

impl Engine {
    fn binary_name(self) -> &'static str {
        match self {
            Engine::Xelatex => "xelatex",
            Engine::Pdflatex => "pdflatex",
        }
    }
}

impl From<Engine> for SystemTexEngine {
    fn from(engine: Engine) -> Self {
        match engine {
            Engine::Xelatex => SystemTexEngine::Xelatex,
            Engine::Pdflatex => SystemTexEngine::Pdflatex,
        }
    }
}

/// Runs `child` to completion, killing it if it outlives `timeout` -- the only subprocess code in
/// this crate, so it gets a real safety net: nothing here should be able to hang the app
/// indefinitely just because a user-installed TeX distribution misbehaves.
fn wait_with_timeout(mut child: Child, timeout: Duration) -> Result<ExitStatus, CompileError> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CompileError { message: format!("timed out after {}s", timeout.as_secs()), log: None });
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Tries `xelatex --version`, then `pdflatex --version`. A successful spawn and exit *is* "a
/// real, working install" (task 4.9's own bar) -- stronger than a bare `PATH` search, which would
/// still find a corrupt binary. Identical for TeX Live and MiKTeX: `Command` already resolves via
/// `PATH` (and `PATHEXT`/`.exe` on Windows) the same way on every OS, so no platform branching is
/// needed to satisfy "works with TeX Live and MiKTeX."
pub fn detect() -> Option<(Engine, String)> {
    for engine in [Engine::Xelatex, Engine::Pdflatex] {
        let Ok(output) = Command::new(engine.binary_name()).arg("--version").stdin(Stdio::null()).output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or_default().trim().to_string();
        return Some((engine, version));
    }
    None
}

/// `root_relative` is resolved against `current_dir(build_dir)`, matching exactly how
/// `write_into_shadow` already mirrors the whole project (including the root document) under the
/// shadow dir by its project-relative path. `-jobname=texput` matches this codebase's existing
/// fixed output-file convention (`texput.pdf`/`.aux`/`.log`), so nothing downstream needs to know
/// or care which engine produced them.
fn run_pass(engine: Engine, root_relative: &Path, build_dir: &Path) -> Result<String, CompileError> {
    let child = Command::new(engine.binary_name())
        .arg("-interaction=nonstopmode")
        .arg(format!("-output-directory={}", build_dir.display()))
        .arg("-jobname=texput")
        .arg(root_relative)
        .current_dir(build_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CompileError { message: format!("{} failed to start: {e}", engine.binary_name()), log: None })?;

    wait_with_timeout(child, PASS_TIMEOUT)?;

    // Read the log regardless of exit code -- an ordinary recoverable LaTeX error doesn't abort a
    // real xelatex/pdflatex run in nonstopmode, matching Tectonic's own behavior where the actual
    // pass/fail verdict is whether a PDF exists once every pass has finished (checked by the
    // caller), not any single pass's own exit code.
    Ok(fs::read_to_string(build_dir.join("texput.log")).unwrap_or_default())
}

fn run_bibtex(build_dir: &Path) -> Result<(), CompileError> {
    let child = Command::new("bibtex")
        .arg("texput")
        .current_dir(build_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CompileError { message: format!("bibtex failed to start: {e}"), log: None })?;

    let status = wait_with_timeout(child, PASS_TIMEOUT)?;
    if !status.success() {
        // BibTeX's own exit code is a reliable fail signal (unlike a TeX pass) -- it either
        // resolves the bibliography or reports a real problem (a missing .bib, a malformed
        // entry), matching `rerun::run_bibtex_pass`'s existing Tectonic-side behavior.
        let log = fs::read_to_string(build_dir.join("texput.blg")).unwrap_or_default();
        return Err(CompileError { message: "BibTeX failed".to_string(), log: (!log.trim().is_empty()).then_some(log) });
    }
    Ok(())
}

/// `root_relative` must already exist under `build_dir` (the shadow dir `handlers::compile`
/// populates for every real project file, root document included).
pub fn compile(engine: Engine, root_relative: &Path, build_dir: &Path) -> Result<CompileOutput, CompileError> {
    fs::create_dir_all(build_dir)?;

    let last_log =
        crate::rerun::run_passes_with_rerun(build_dir, || run_pass(engine, root_relative, build_dir), || run_bibtex(build_dir))?;

    let pdf = fs::read(build_dir.join("texput.pdf")).map_err(|_| CompileError {
        message: format!("{} didn't report failure, but no PDF was created", engine.binary_name()),
        log: (!last_log.trim().is_empty()).then(|| last_log.clone()),
    })?;

    let (page_count, changed_pages) = crate::rerun::hash_and_diff_pages(build_dir, &pdf)?;
    Ok(CompileOutput { pdf, page_count, changed_pages, log: last_log })
}
