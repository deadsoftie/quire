//! Task 3.6's acceptance criterion: "Benchmark on a 50-file thesis," target ≤10ms for a
//! single-file change. `tests/fixtures/thesis_50/` is 51 real `.tex` files (~1000 lines total,
//! cross-referencing labels/citations/macros across files, not trivial stubs) standing in for an
//! actual thesis.
//!
//! There's no cache here, deliberately -- see `crates/quire-core/src/index/mod.rs`'s own doc
//! comment for why a full rebuild turned out to already meet the target with real margin
//! (measured ~2ms release / ~5ms debug locally), and why a disk-persisted cross-process cache
//! (the only kind that could work at all, given `quire-sidecar` spawns a fresh process per RPC
//! call -- see `docs/CONTRACT.md`) wasn't worth building for a problem that's already solved.
//!
//! The assertion threshold below is a regression guard, not a reproduction of the 10ms target
//! itself -- generous enough to absorb CI-machine noise without being flaky, tight enough to
//! catch an actual multi-x slowdown. The real number is printed alongside it either way.

use std::path::Path;
use std::time::Instant;

use quire_core::index::ProjectIndex;
use quire_core::project::build_file_graph;

#[test]
fn full_reindex_of_a_50_file_thesis_stays_well_under_budget() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/thesis_50/main.tex");
    let graph = build_file_graph(&root);
    assert_eq!(graph.files.len(), 51, "fixture should be main.tex + 50 chapters: {}", graph.files.len());

    // Warm up (page cache, allocator) before timing -- the first call on a cold cache is not
    // representative of steady-state editing, which is what the acceptance criterion cares about.
    let _ = ProjectIndex::build(&graph);

    const RUNS: u32 = 20;
    let start = Instant::now();
    for _ in 0..RUNS {
        let _index = ProjectIndex::build(&graph);
    }
    let avg = start.elapsed() / RUNS;
    println!("ProjectIndex::build average over {RUNS} runs on a 51-file thesis: {avg:?}");

    assert!(
        avg.as_millis() < 30,
        "full reindex averaged {avg:?} on a 50-file thesis -- well over the 10ms target with the \
         margin this test allows for CI noise; something regressed, or the fixture/database grew \
         enough that the no-cache decision documented in index/mod.rs needs revisiting"
    );
}
