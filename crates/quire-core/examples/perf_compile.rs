use std::env;
use std::path::PathBuf;
use std::time::Instant;

use quire_core::rpc::handlers::compile;
use quire_core::rpc::{CompileEngine, CompileReason, CompileRequest, CompileStatus};

fn default_fixture_dir() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/perf_thesis"
    ))
}

fn run_once(project_id: &str, reason: CompileReason) -> (u128, CompileStatus, u32, Vec<String>) {
    let req = CompileRequest {
        project_id: project_id.to_string(),
        dirty_buffers: Vec::new(),
        reason,
        engine: CompileEngine::Tectonic,
        target_root: None,
    };
    let start = Instant::now();
    let result = compile(&req).expect("compile() itself should never Err for a real project");
    (
        start.elapsed().as_millis(),
        result.status,
        result.page_count,
        result.missing_packages,
    )
}

fn main() {
    let project_dir = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(default_fixture_dir);
    if !project_dir.is_dir() {
        eprintln!(
            "{} doesn't exist - see PERFORMANCE_PASS_PLAN.md prerequisite 1",
            project_dir.display()
        );
        std::process::exit(1);
    }
    let project_id = project_dir.to_string_lossy().to_string();

    println!("Cold compile (first run, package prefetch/network fetch included in this number):");
    let req = CompileRequest {
        project_id: project_id.clone(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Open,
        engine: CompileEngine::Tectonic,
        target_root: None,
    };
    let start = Instant::now();
    let result = compile(&req).expect("compile() itself should never Err for a real project");
    println!(
        "  {}ms - status: {:?}, {} pages, missing: {:?}",
        start.elapsed().as_millis(),
        result.status,
        result.page_count,
        result.missing_packages
    );
    for d in &result.diagnostics {
        println!(
            "    diagnostic: {} ({:?})\n    raw: {}",
            d.message, d.uri, d.raw_message
        );
    }

    println!("Warm compiles (body unchanged, x5):");
    let mut warm_ms = Vec::new();
    for i in 1..=5 {
        let (ms, status, pages, missing) = run_once(&project_id, CompileReason::Edit);
        println!("  run {i}: {ms}ms - status: {status:?}, {pages} pages, missing: {missing:?}");
        warm_ms.push(ms);
    }
    warm_ms.sort_unstable();
    println!("  median: {}ms", warm_ms[warm_ms.len() / 2]);
}
