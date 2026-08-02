use std::path::Path;
use std::time::Instant;

use quire_core::index::ProjectIndex;
use quire_core::project::build_file_graph;

#[test]
fn full_reindex_of_a_50_file_thesis_stays_well_under_budget() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/thesis_50/main.tex");
    let graph = build_file_graph(&root);
    // main.tex + 50 chapters + refs.bib -- the .bib is a real FileGraph leaf, not silently dropped.
    assert_eq!(graph.files.len(), 52, "fixture should be main.tex + 50 chapters + refs.bib: {}", graph.files.len());

    let _ = ProjectIndex::build(&graph);

    const RUNS: u32 = 20;
    let start = Instant::now();
    for _ in 0..RUNS {
        let _index = ProjectIndex::build(&graph);
    }
    let avg = start.elapsed() / RUNS;
    println!("ProjectIndex::build average over {RUNS} runs on a 52-file thesis: {avg:?}");

    assert!(
        avg.as_millis() < 30,
        "full reindex averaged {avg:?} on a 50-file thesis -- well over the 10ms target with the \
         margin this test allows for CI noise; something regressed, or the fixture/database grew \
         enough that the no-cache decision documented in index/mod.rs needs revisiting"
    );
}
