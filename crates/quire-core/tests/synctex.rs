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
fn inverse_sync_finds_the_containing_paragraph_line() {
    let parsed = load_from_txt();
    // Center of the known rect from the forward-sync test above.
    let result = parsed.inverse_sync(1, 305.6, 132.16);
    assert_eq!(result, Some((1, 4, Confidence::High)));
}

#[test]
fn inverse_sync_deep_in_the_page_lands_on_a_low_confidence_box() {
    let parsed = load_from_txt();
    // Far from either paragraph's text -- should resolve to one of the
    // big finalization boxes tagged line 6, not the wrong line.
    let result = parsed.inverse_sync(1, 300.0, 300.0);
    assert_eq!(result.map(|(tag, line, _)| (tag, line)), Some((1, 6)));
    assert_eq!(result.unwrap().2, Confidence::Low);
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
