//! Page hashing (task 1.7).
//!
//! Hash each rendered page's content stream and diff against the previous
//! compile, so the UI can re-render only the pages that actually changed
//! (`changedPages` in `CompileResponse`, Section 6) instead of the whole
//! document on every keystroke.
//!
//! "Content stream," not "page object" or "whole file": a page's PDF
//! object also carries things like font resource references and
//! annotation dictionaries that can shift between compiles (a resource
//! gets renumbered, a font subset changes) without anything actually
//! *drawn* on that page changing. Hashing just the content stream --
//! the sequence of drawing operators -- is what makes an untouched page
//! hash identically across compiles.
//!
//! Uses `lopdf` rather than hand-rolling a parser: inspecting a real
//! compiled PDF from this project's own pipeline showed Tectonic's
//! xdvipdfmx output uses PDF 1.5+ cross-reference *streams* (not a classic
//! `xref` table) and packs page objects into compressed object streams by
//! default -- `/Type/Page` doesn't even appear as plaintext in the raw
//! file, it's inside a compressed `/Type/ObjStm`. A byte-scanning
//! approach can't find pages at all under those conditions; correctly
//! resolving object references needs real xref-stream and object-stream
//! decoding per the PDF spec, which is well-trodden generic infrastructure
//! (like gzip or JSON parsing elsewhere in this codebase), not something
//! worth re-implementing by hand.

use tectonic::digest::{self, Digest};

use crate::CompileError;

/// Hashes each page's content stream, in page order (1-indexed pages,
/// though the index itself isn't in the returned list -- position in the
/// vec *is* the page number, `hashes[0]` is page 1).
pub fn hash_pages(pdf_bytes: &[u8]) -> Result<Vec<String>, CompileError> {
    let doc = lopdf::Document::load_mem(pdf_bytes).map_err(|e| CompileError {
        message: format!("failed to parse compiled PDF for page hashing: {e}"),
        log: None,
    })?;

    // BTreeMap<page_number, ObjectId>, so this iterates in page order
    // already -- no separate sort needed.
    Ok(doc
        .get_pages()
        .into_iter()
        .map(|(_page_number, page_id)| {
            let content = doc.get_page_content(page_id);
            let mut hasher = digest::create();
            hasher.update(&content);
            digest::bytes_to_hex(&hasher.finalize())
        })
        .collect())
}

/// Compares a previous compile's page hashes against the current one and
/// returns the 1-indexed page numbers that changed.
///
/// `previous: None` (no prior compile to diff against -- e.g. the very
/// first compile of a project) reports every page as changed, same as a
/// page-count change: if the page count itself shifted, there's no
/// reliable page-to-page correspondence to diff against (an edit on page 3
/// can push everything after it forward or back by a page), so this falls
/// back to "everything changed" rather than guessing at an alignment and
/// risking silently wrong incremental rendering.
pub fn diff_pages(previous: Option<&[String]>, current: &[String]) -> Vec<u32> {
    let all_changed = || (1..=current.len() as u32).collect();

    let Some(previous) = previous else {
        return all_changed();
    };

    if previous.len() != current.len() {
        return all_changed();
    }

    previous
        .iter()
        .zip(current.iter())
        .enumerate()
        .filter_map(|(i, (old, new))| (old != new).then_some((i + 1) as u32))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hashes(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_previous_reports_everything_changed() {
        let current = hashes(&["a", "b", "c"]);
        assert_eq!(diff_pages(None, &current), vec![1, 2, 3]);
    }

    #[test]
    fn identical_reports_nothing_changed() {
        let previous = hashes(&["a", "b", "c"]);
        let current = hashes(&["a", "b", "c"]);
        assert_eq!(diff_pages(Some(&previous), &current), Vec::<u32>::new());
    }

    #[test]
    fn single_page_edit_reports_only_that_page() {
        let previous = hashes(&["a", "b", "c"]);
        let current = hashes(&["a", "X", "c"]);
        assert_eq!(diff_pages(Some(&previous), &current), vec![2]);
    }

    #[test]
    fn multiple_page_edits_report_all_of_them() {
        let previous = hashes(&["a", "b", "c", "d"]);
        let current = hashes(&["X", "b", "Y", "d"]);
        assert_eq!(diff_pages(Some(&previous), &current), vec![1, 3]);
    }

    #[test]
    fn page_count_change_falls_back_to_everything_changed() {
        let previous = hashes(&["a", "b", "c"]);
        let current = hashes(&["a", "b", "c", "d"]);
        assert_eq!(diff_pages(Some(&previous), &current), vec![1, 2, 3, 4]);
    }
}
