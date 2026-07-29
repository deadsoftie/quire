//! Hashes each page's content stream (not the whole page object, since resource renumbering can shift that without any drawn content changing) to diff pages across compiles.

use tectonic::digest::{self, Digest};

use crate::CompileError;

/// Position in the returned vec is the page number: `hashes[0]` is page 1.
pub fn hash_pages(pdf_bytes: &[u8]) -> Result<Vec<String>, CompileError> {
    let doc = lopdf::Document::load_mem(pdf_bytes).map_err(|e| CompileError {
        message: format!("failed to parse compiled PDF for page hashing: {e}"),
        log: None,
    })?;

    // get_pages() returns a BTreeMap<page_number, ObjectId>, already in page order.
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

/// No previous hashes, or a page-count change, reports everything changed -- there's no reliable page alignment to diff against otherwise.
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
