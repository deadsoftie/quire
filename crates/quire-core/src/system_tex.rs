//! An opt-in fallback that shells out to a system TeX Live/MiKTeX install; the only subprocess in this crate, and the one path that can never exist on iPad.

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

/// Runs `child` to completion, killing it if it outlives `timeout` so a misbehaving TeX install can't hang the app.
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

/// Tries `xelatex --version`, then `pdflatex --version`; a successful spawn and exit is stronger than a bare `PATH` search.
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

/// `-jobname=texput` matches this codebase's fixed output-file convention regardless of which engine ran.
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

    // Read the log regardless of exit code -- a recoverable LaTeX error doesn't abort nonstopmode.
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
        // Unlike a TeX pass, BibTeX's own exit code is a reliable fail signal.
        let log = fs::read_to_string(build_dir.join("texput.blg")).unwrap_or_default();
        return Err(CompileError { message: "BibTeX failed".to_string(), log: (!log.trim().is_empty()).then_some(log) });
    }
    Ok(())
}

/// `root_relative` must already exist under `build_dir`, the shadow dir `handlers::compile` populates.
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
