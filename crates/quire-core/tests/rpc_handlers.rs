use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::{compile, open_project, outline, prefetch_packages, replace_in_project, search_project};
use quire_core::rpc::{
    CompileEngine, CompileReason, CompileRequest, CompileStatus, DirtyBuffer, FileNodeKind, OpenProjectRequest,
    OutlineRequest, PrefetchPackagesRequest, ReplaceInProjectRequest, RootConfidence, SearchProjectRequest,
};

fn copy_dir(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let target = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).unwrap();
        }
    }
}

fn fresh_project_copy(fixture: &str, name: &str) -> PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(fixture);
    let dst = std::env::temp_dir().join(format!("quire-core-rpc-handlers-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dst);
    copy_dir(&src, &dst);
    dst
}

fn fresh_empty_project(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("quire-core-rpc-handlers-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn search_request(project_id: &str, query: &str) -> SearchProjectRequest {
    SearchProjectRequest {
        project_id: project_id.to_string(),
        query: query.to_string(),
        case_sensitive: false,
        whole_word: false,
        regex: false,
        dirty_buffers: Vec::new(),
    }
}

fn replace_request(project_id: &str, query: &str, replacement: &str) -> ReplaceInProjectRequest {
    ReplaceInProjectRequest {
        project_id: project_id.to_string(),
        query: query.to_string(),
        replacement: replacement.to_string(),
        case_sensitive: false,
        whole_word: false,
        regex: false,
        dirty_buffers: Vec::new(),
    }
}

#[test]
fn open_project_finds_root_and_full_file_list() {
    let project_dir = fresh_project_copy("project_graph", "open");

    let resp = open_project(&OpenProjectRequest { path: project_dir.display().to_string() })
        .expect("open_project should succeed on a real fixture");

    assert_eq!(resp.project_id, project_dir.display().to_string());
    assert!(resp.root.ends_with("main.tex"), "root = {}", resp.root);
    assert_eq!(resp.root_confidence, RootConfidence::Inferred);
    assert!(resp.candidates.is_empty());
    assert!(resp.engine_available);

    let names: Vec<&str> = resp.files.iter().map(|f| f.name.as_str()).collect();
    assert!(names.contains(&"main.tex"), "{names:?}");
    assert!(names.contains(&"intro.tex"), "{names:?}");
    assert!(names.contains(&"middle.tex"), "{names:?}");
    assert!(names.contains(&"nested.tex"), "{names:?}");
    assert!(names.contains(&"plot.pdf"), "resolved \\includegraphics should be in the graph: {names:?}");
    assert!(!names.iter().any(|n| n.contains("missing")), "the dangling \\includegraphics must not appear: {names:?}");

    let plot = resp.files.iter().find(|f| f.name == "plot.pdf").unwrap();
    assert_eq!(plot.kind, FileNodeKind::Graphic);
    let main = resp.files.iter().find(|f| f.name == "main.tex").unwrap();
    assert_eq!(main.kind, FileNodeKind::Tex);

    fs::remove_dir_all(&project_dir).ok();
}

/// A .bib file is a real, visible entry in openProject()'s file list, not just mirrored into the shadow dir invisibly.
#[test]
fn open_project_exposes_bibliography_files_with_the_real_bib_kind() {
    let project_dir = fresh_project_copy("compile_with_bibliography", "open-bib");

    let resp = open_project(&OpenProjectRequest { path: project_dir.display().to_string() })
        .expect("open_project should succeed on a real fixture");

    let refs = resp.files.iter().find(|f| f.name == "refs.bib").expect("refs.bib should be in the file list");
    assert_eq!(refs.kind, FileNodeKind::Bib);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn open_project_pins_the_bundle_version_and_notices_only_on_a_real_mismatch() {
    let project_dir = fresh_project_copy("project_graph", "pin");
    let metadata_path = project_dir.join(".quire").join("project.json");
    let current = quire_core::bundle::digest_hex().expect("a bundle should be resolvable in tests");

    // First-ever open: nothing pinned yet, so nothing to compare against.
    let first = open_project(&OpenProjectRequest { path: project_dir.display().to_string() }).unwrap();
    assert!(first.bundle_version_notice.is_none(), "{:?}", first.bundle_version_notice);
    let pinned = fs::read_to_string(&metadata_path).expect(".quire/project.json should exist after the first open");
    assert!(pinned.contains(&current), "pinned file should record the real current digest: {pinned}");

    // Second open, same bundle: pin matches, still nothing to report.
    let second = open_project(&OpenProjectRequest { path: project_dir.display().to_string() }).unwrap();
    assert!(second.bundle_version_notice.is_none(), "{:?}", second.bundle_version_notice);

    // Simulate the bundle having changed since the last open by hand-editing the pinned value.
    fs::write(&metadata_path, r#"{"bundleVersion":"deliberately-not-the-real-digest"}"#).unwrap();
    let third = open_project(&OpenProjectRequest { path: project_dir.display().to_string() }).unwrap();
    assert!(third.bundle_version_notice.is_some(), "a real mismatch should produce a notice");

    // The mismatch notice also re-pins to the current version -- it must not repeat on the very next open.
    let fourth = open_project(&OpenProjectRequest { path: project_dir.display().to_string() }).unwrap();
    assert!(fourth.bundle_version_notice.is_none(), "{:?}", fourth.bundle_version_notice);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn prefetch_fetches_a_package_missing_from_bundle_and_cache() {
    let project_dir = fresh_project_copy("prefetch", "prefetch");
    let project_id = project_dir.display().to_string();

    let resp = prefetch_packages(&PrefetchPackagesRequest { project_id: project_id.clone() });

    // `article` is always in the core bundle. `media9` may or may not need a fetch depending on cache state, but must not genuinely fail.
    assert!(!resp.fetched.iter().any(|f| f.name == "article"), "{:?}", resp.fetched);
    assert!(!resp.failed.contains(&"article".to_string()), "{:?}", resp.failed);
    assert!(!resp.failed.contains(&"media9".to_string()), "media9 fetch failed: {:?}", resp.failed);
    if let Some(media9) = resp.fetched.iter().find(|f| f.name == "media9") {
        assert!(media9.bytes > 0, "media9 was fetched but reported 0 bytes");
    }

    // Second call: whatever the first needed is cached now, so nothing should be reported missing.
    let resp2 = prefetch_packages(&PrefetchPackagesRequest { project_id: project_id.clone() });
    assert!(resp2.fetched.is_empty() && resp2.failed.is_empty(), "fetched={:?} failed={:?}", resp2.fetched, resp2.failed);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn compile_reports_packages_missing_with_the_real_package_name() {
    let project_dir = fresh_project_copy("missing_package", "missing-package");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should not error at the RPC level even though the document itself fails");

    assert_eq!(resp.status, CompileStatus::PackagesMissing);
    assert_eq!(resp.missing_packages, vec!["this-package-definitely-does-not-exist-anywhere"]);
    assert!(resp.pdf_path.is_none());

    // Never a raw, untranslated "File `...' not found" -- must be the plain-English diagnostic.
    let diagnostic = &resp.diagnostics[0];
    assert_eq!(diagnostic.code.as_deref(), Some("missing-package"));
    assert!(diagnostic.message.contains("this-package-definitely-does-not-exist-anywhere"));

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn compile_mirrors_the_whole_graph_and_produces_a_real_pdf() {
    let project_dir = fresh_project_copy("compile_multi_file", "compile-basic");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should succeed");

    assert_eq!(resp.status, CompileStatus::Ok);
    let pdf_path = resp.pdf_path.expect("a successful compile must report a pdf path");
    let pdf = fs::read(&pdf_path).expect("the reported pdf path should be a real file");
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(resp.page_count >= 1);
    assert!(!resp.bundle_version.is_empty());

    let shadow = project_dir.join(".quire").join("build");
    assert!(shadow.join("chapters/intro.tex").is_file());
    assert!(shadow.join("chapters/middle.tex").is_file());

    fs::remove_dir_all(&project_dir).ok();
}

/// Proves end to end that `.bib` mirrors into the shadow dir and `\cite{...}` actually resolves.
#[test]
fn compile_resolves_a_real_bibliography_citation() {
    let project_dir = fresh_project_copy("compile_with_bibliography", "compile-bib");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should succeed");

    assert_eq!(resp.status, CompileStatus::Ok, "{:?}", resp.diagnostics);
    assert!(
        !resp.diagnostics.iter().any(|d| d.code.as_deref() == Some("undefined-citation")),
        "the citation should have resolved via the mirrored .bib, not stayed undefined: {:?}",
        resp.diagnostics
    );

    let shadow = project_dir.join(".quire").join("build");
    assert!(shadow.join("refs.bib").is_file(), "refs.bib must be mirrored into the shadow build dir");

    fs::remove_dir_all(&project_dir).ok();
}

/// Proves `handlers::compile()`'s `engine: System` branch works end to end; skips (not fails) with no system TeX install.
#[test]
fn compile_with_system_engine_produces_a_real_pdf_when_a_system_install_exists() {
    if quire_core::system_tex::detect().is_none() {
        eprintln!("skipping: no system TeX install detected on this machine");
        return;
    }

    let project_dir = fresh_project_copy("compile_multi_file", "compile-system-tex");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
        engine: CompileEngine::System,
    })
    .expect("compile should succeed");

    assert_eq!(resp.status, CompileStatus::Ok, "{:?}", resp.diagnostics);
    let pdf_path = resp.pdf_path.expect("a successful compile must report a pdf path");
    let pdf = fs::read(&pdf_path).expect("the reported pdf path should be a real file");
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(resp.page_count >= 1);

    fs::remove_dir_all(&project_dir).ok();
}

/// A genuinely ambiguous project (two files each with a real `\documentclass`) must still compile against a best guess.
#[test]
fn compile_falls_back_to_the_first_candidate_when_root_is_ambiguous() {
    let project_dir = fresh_project_copy("root_detection/ambiguous", "compile-ambiguous");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should fall back to a best-guess root instead of erroring");

    assert_eq!(resp.status, CompileStatus::Ok, "{:?}", resp.diagnostics);

    fs::remove_dir_all(&project_dir).ok();
}

/// A workspace holding several independent standalone documents (no `\input`/`\include` chain
/// between them) makes root detection ambiguous for the whole project, not just the files that
/// are actually ambiguous with each other. Outline must still work for a document requested by
/// its own URI instead of going empty for every file in the workspace.
#[test]
fn outline_falls_back_to_the_requested_file_when_root_is_ambiguous() {
    let project_dir = fresh_empty_project("outline-ambiguous");
    fs::write(
        project_dir.join("fileA.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\section*{Alpha}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(
        project_dir.join("fileB.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\section*{Beta}\n\\end{document}\n",
    )
    .unwrap();

    let project_id = project_dir.display().to_string();
    let file_a_uri = project_dir.join("fileA.tex").display().to_string();

    let nodes = outline(&OutlineRequest { project_id, uri: file_a_uri });

    assert_eq!(nodes.len(), 1, "expected fileA's own section to be indexed despite the ambiguous project root");
    assert_eq!(nodes[0].label, "Alpha");

    fs::remove_dir_all(&project_dir).ok();
}

/// Pasting into a brand-new, still-empty-on-disk file and compiling before saving must still detect it as the root.
#[test]
fn compile_recognizes_root_from_a_dirty_buffer_on_an_unsaved_new_file() {
    let project_dir = std::env::temp_dir().join(format!("quire-core-rpc-handlers-test-compile-new-file-{}", std::process::id()));
    let _ = fs::remove_dir_all(&project_dir);
    fs::create_dir_all(&project_dir).unwrap();
    fs::write(project_dir.join("main.tex"), "").unwrap();

    let main_uri = project_dir.join("main.tex").display().to_string();
    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: vec![DirtyBuffer {
            uri: main_uri,
            text: "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n".to_string(),
        }],
        reason: CompileReason::Edit,
        engine: CompileEngine::Tectonic,
    })
    .expect("compile should succeed even though main.tex is still empty on disk");

    assert_eq!(resp.status, CompileStatus::Ok, "{:?}", resp.diagnostics);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn dirty_buffer_on_a_non_root_subfile_is_honored_and_changes_are_detected() {
    let project_dir = fresh_project_copy("compile_multi_file", "compile-dirty");
    let project_id = project_dir.display().to_string();

    compile(&CompileRequest {
        project_id: project_id.clone(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Open,
        engine: CompileEngine::Tectonic,
    })
    .expect("first compile should succeed");

    let intro_uri = project_dir.join("chapters/intro.tex").display().to_string();
    let resp = compile(&CompileRequest {
        project_id: project_id.clone(),
        dirty_buffers: vec![DirtyBuffer {
            uri: intro_uri,
            text: "Edited intro content, not what's on disk.\n".to_string(),
        }],
        reason: CompileReason::Edit,
        engine: CompileEngine::Tectonic,
    })
    .expect("second compile with a dirty non-root buffer should succeed");

    assert_eq!(resp.status, CompileStatus::Ok);

    let shadow_intro = fs::read_to_string(project_dir.join(".quire/build/chapters/intro.tex")).unwrap();
    assert!(
        shadow_intro.contains("Edited intro content"),
        "the shadow copy of the dirty (non-root) file should reflect the buffer, not disk: {shadow_intro:?}"
    );

    let real_intro = fs::read_to_string(project_dir.join("chapters/intro.tex")).unwrap();
    assert!(!real_intro.contains("Edited intro content"));

    assert!(
        !resp.changed_pages.is_empty(),
        "editing a subfile that's actually included should register as a content change"
    );

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn search_project_finds_matches_across_multiple_files_and_reports_correct_positions() {
    let project_dir = fresh_project_copy("compile_multi_file", "search-multi-file");
    let project_id = project_dir.display().to_string();

    let resp = search_project(&search_request(&project_id, "content")).expect("search should succeed");

    assert_eq!(resp.matches.len(), 2, "{:?}", resp.matches);
    assert!(!resp.truncated);

    let intro = resp.matches.iter().find(|m| m.uri.ends_with("intro.tex")).expect("intro.tex should match");
    assert_eq!(intro.line, 0);
    assert_eq!(intro.column, 6, "\"Intro \" is 6 UTF-16 units before \"content\"");
    assert_eq!(intro.match_length, 7);
    assert_eq!(intro.line_text, "Intro content.");

    let middle = resp.matches.iter().find(|m| m.uri.ends_with("middle.tex")).expect("middle.tex should match");
    assert_eq!(middle.column, 7, "\"Middle \" is 7 UTF-16 units before \"content\"");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn search_project_prefers_dirty_buffer_text_over_disk() {
    let project_dir = fresh_empty_project("search-dirty");
    fs::write(project_dir.join("main.tex"), "original disk content\n").unwrap();
    let project_id = project_dir.display().to_string();
    let main_uri = project_dir.join("main.tex").display().to_string();

    let req = SearchProjectRequest {
        dirty_buffers: vec![DirtyBuffer { uri: main_uri, text: "unsaved-only-term appears here\n".to_string() }],
        ..search_request(&project_id, "unsaved-only-term")
    };
    let resp = search_project(&req).expect("search should succeed");

    assert_eq!(resp.matches.len(), 1, "{:?}", resp.matches);

    let on_disk = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    assert!(!on_disk.contains("unsaved-only-term"), "search must not itself write the dirty buffer to disk");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn search_project_whole_word_option_excludes_partial_matches() {
    let project_dir = fresh_empty_project("search-whole-word");
    fs::write(project_dir.join("main.tex"), "Cat cats category\n").unwrap();
    let project_id = project_dir.display().to_string();

    let without = search_project(&search_request(&project_id, "cat")).unwrap();
    assert_eq!(without.matches.len(), 3, "case-insensitive substring match should hit Cat, cats, category: {:?}", without.matches);

    let with = SearchProjectRequest { whole_word: true, ..search_request(&project_id, "cat") };
    let resp = search_project(&with).unwrap();
    assert_eq!(resp.matches.len(), 1, "whole_word must reject cats/category as partial matches: {:?}", resp.matches);
    assert_eq!(resp.matches[0].column, 0);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn search_project_case_sensitive_option_excludes_different_case() {
    let project_dir = fresh_empty_project("search-case-sensitive");
    fs::write(project_dir.join("main.tex"), "Cat\ncat\n").unwrap();
    let project_id = project_dir.display().to_string();

    let insensitive = search_project(&search_request(&project_id, "Cat")).unwrap();
    assert_eq!(insensitive.matches.len(), 2, "{:?}", insensitive.matches);

    let sensitive = SearchProjectRequest { case_sensitive: true, ..search_request(&project_id, "Cat") };
    let resp = search_project(&sensitive).unwrap();
    assert_eq!(resp.matches.len(), 1, "{:?}", resp.matches);
    assert_eq!(resp.matches[0].line, 0);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn search_project_rejects_invalid_regex_with_a_compile_error() {
    let project_dir = fresh_empty_project("search-bad-regex");
    fs::write(project_dir.join("main.tex"), "anything\n").unwrap();
    let project_id = project_dir.display().to_string();

    let req = SearchProjectRequest { regex: true, ..search_request(&project_id, "(unclosed") };
    let err = search_project(&req).expect_err("an invalid regex must be a normal RPC error, not a panic");
    assert!(err.message.contains("invalid search pattern"), "{}", err.message);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn replace_in_project_rewrites_matching_files_on_disk_and_returns_new_text() {
    let project_dir = fresh_empty_project("replace-basic");
    fs::write(project_dir.join("main.tex"), "Hello world\nHello there\n").unwrap();
    let project_id = project_dir.display().to_string();

    let resp = replace_in_project(&replace_request(&project_id, "Hello", "Goodbye")).expect("replace should succeed");

    assert_eq!(resp.files.len(), 1, "{:?}", resp.files);
    let file = &resp.files[0];
    assert_eq!(file.replacements, 2);
    assert_eq!(file.new_text, "Goodbye world\nGoodbye there\n");

    let on_disk = fs::read_to_string(project_dir.join("main.tex")).unwrap();
    assert_eq!(on_disk, file.new_text);

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn replace_in_project_literal_dollar_sign_is_inserted_verbatim_not_expanded() {
    let project_dir = fresh_empty_project("replace-literal-dollar");
    fs::write(project_dir.join("main.tex"), "price: 10\n").unwrap();
    let project_id = project_dir.display().to_string();

    // Non-regex mode: `$5` in the replacement must be inserted literally, not treated as a capture-group reference.
    let resp = replace_in_project(&replace_request(&project_id, "price", "$5 total")).expect("replace should succeed");

    assert_eq!(resp.files.len(), 1, "{:?}", resp.files);
    assert_eq!(resp.files[0].new_text, "$5 total: 10\n");

    fs::remove_dir_all(&project_dir).ok();
}

#[test]
fn replace_in_project_skips_files_with_zero_matches() {
    let project_dir = fresh_project_copy("compile_multi_file", "replace-skip-zero");
    let project_id = project_dir.display().to_string();

    // "Intro content" (not just "Intro") -- main.tex's own \input{chapters/intro} also literally
    // contains "intro", which a case-insensitive query for the bare word would otherwise also match.
    let resp =
        replace_in_project(&replace_request(&project_id, "Intro content", "Chapter content")).expect("replace should succeed");

    assert_eq!(resp.files.len(), 1, "only intro.tex contains \"Intro content\": {:?}", resp.files);
    assert!(resp.files[0].uri.ends_with("intro.tex"));

    fs::remove_dir_all(&project_dir).ok();
}
