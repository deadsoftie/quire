// Fixture (tests/fixtures/sample.synctex.{txt,gz}) is real Tectonic output
// for the source in this comment, captured once via a throwaway example
// (see the 0.6 commit). Expected numbers below were computed by hand from
// that captured text (sp / 65781.76 = pt), not invented.
//
//   \documentclass{article}
//   \begin{document}
//   Hello, world!
//
//   A second paragraph with more text, so there is more than one line to look at.
//   \end{document}

use quire_core::synctex::{Confidence, SyncTex};
use std::fs;

fn approx_eq(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.01
}

fn load_from_txt() -> SyncTex {
    let text = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/sample.synctex.txt"
    ))
    .unwrap();
    SyncTex::parse_str(&text)
}

fn load_from_gz() -> SyncTex {
    let gz = fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/sample.synctex.gz"
    ))
    .unwrap();
    SyncTex::parse_gz(&gz).unwrap()
}

#[test]
fn forward_sync_finds_known_rect_on_first_paragraph_line() {
    for parsed in [load_from_txt(), load_from_gz()] {
        // Source line 4 (the blank line ending "Hello, world!") carries the
        // paragraph's vbox, its closing kern, and a zero-size glue point:
        // (1,4:8799519,8865055:22609920,469238,126483
        // k1,4:31409439,8865055:17983734
        // g1,4:31409439,8865055
        let (rects, confidence) = parsed.forward_sync(1, 4);
        assert_eq!(rects.len(), 3, "expected the vbox, its kern, and a glue point");

        let boxed = rects
            .iter()
            .find(|r| r.w > 0.0)
            .expect("one rect should be the non-zero-size vbox");

        assert!(approx_eq(boxed.x, 133.768), "x was {}", boxed.x);
        assert!(approx_eq(boxed.y, 127.631), "y was {}", boxed.y);
        assert!(approx_eq(boxed.w, 343.711), "w was {}", boxed.w);
        assert!(approx_eq(boxed.h, 9.056), "h was {}", boxed.h);
        assert_eq!(confidence, Confidence::High);
    }
}

#[test]
fn forward_sync_on_finalization_line_is_low_confidence() {
    // \end{document} (line 6) owns several full-page-height boxes.
    let parsed = load_from_txt();
    let (rects, confidence) = parsed.forward_sync(1, 6);
    assert!(!rects.is_empty());
    assert_eq!(confidence, Confidence::Low);
}

#[test]
fn inverse_sync_finds_the_nearest_leaf_not_an_enclosing_container() {
    let parsed = load_from_txt();
    // h1,5:8799519,9651487:983040,0,0 -- the indent leaf for paragraph 2
    // ("A second paragraph...", line 5). Querying its own center must
    // resolve to line 5, not to the line tagging whatever big *container*
    // box happens to enclose this point (real bug: the enclosing
    // paragraph vbox for "Hello, world!" is tagged line 4, and the page's
    // outer box is tagged line 6 -- both previously won here purely by
    // being large enough to contain almost any point, which is what made
    // inverse sync resolve to the document's last line almost regardless
    // of where the PDF was actually clicked).
    let result = parsed.inverse_sync(1, 133.768 + 14.944 / 2.0, 146.720);
    assert_eq!(result, Some((1, 5, Confidence::High)));
}

#[test]
fn inverse_sync_far_from_any_content_still_finds_a_leaf_not_a_container() {
    let parsed = load_from_txt();
    // Deep in empty page space, still nowhere near any real content.
    // Before the container-exclusion fix this fell back to whichever
    // giant container box happened to enclose the point (tag 1, line 6 --
    // the document's last line). It must now resolve to some actual leaf
    // instead, even if that leaf is far away.
    let result = parsed.inverse_sync(1, 300.0, 300.0);
    assert!(result.is_some());
    let (tag, line, _) = result.unwrap();
    assert_eq!(tag, 1);
    assert_ne!(line, 6, "must not fall back to the last line's container box");
}

#[test]
fn primary_input_has_no_extension_but_secondary_ones_do_when_present() {
    let parsed = load_from_txt();
    // Ground truth: Tectonic's in-memory primary input, named
    // "texput.tex" internally, comes back from SyncTeX as bare "texput" --
    // the extension quirk described in QUIRE_SPEC.md 0.6, reproduced here
    // for the primary file rather than a \input'd one.
    assert_eq!(parsed.raw_input_path(1), Some("texput"));
}
