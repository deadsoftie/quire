// Explicit \newpage breaks fix page boundaries so a same-length edit can't reflow into neighbors, keeping the exact-page-number assertions below meaningful.

use std::fs;

use quire_core::rerun::compile_latex_in_dir;

fn fresh_build_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("quire-core-page-hash-test-{}-{}", std::process::id(), name));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create build dir");
    dir
}

fn five_pages(page3: &str) -> String {
    format!(
        "\\documentclass{{article}}\n\
         \\begin{{document}}\n\
         Page one content.\n\\newpage\n\
         Page two content.\n\\newpage\n\
         {page3}\n\\newpage\n\
         Page four content.\n\\newpage\n\
         Page five content.\n\
         \\end{{document}}\n"
    )
}

#[test]
fn first_compile_reports_every_page_changed() {
    let build_dir = fresh_build_dir("first");
    let source = five_pages("Page three content.");

    let out = compile_latex_in_dir(&source, &build_dir).expect("first compile");

    assert_eq!(out.page_count, 5);
    assert_eq!(out.changed_pages, vec![1, 2, 3, 4, 5]);
}

#[test]
fn identical_recompile_reports_nothing_changed() {
    let build_dir = fresh_build_dir("identical");
    let source = five_pages("Page three content.");

    compile_latex_in_dir(&source, &build_dir).expect("first compile");
    let out = compile_latex_in_dir(&source, &build_dir).expect("second compile");

    assert_eq!(out.page_count, 5);
    assert_eq!(out.changed_pages, Vec::<u32>::new());
}

#[test]
fn editing_one_page_reports_exactly_that_page() {
    let build_dir = fresh_build_dir("edit");

    compile_latex_in_dir(&five_pages("Page three content."), &build_dir).expect("first compile");
    let out = compile_latex_in_dir(&five_pages("Page three edited!"), &build_dir).expect("second compile");

    assert_eq!(out.page_count, 5);
    assert_eq!(out.changed_pages, vec![3]);
}
