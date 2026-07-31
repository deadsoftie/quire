use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::{compile, open_project, prefetch_packages};
use quire_core::rpc::{
    CompileEngine, CompileReason, CompileRequest, CompileStatus, DirtyBuffer, FileNodeKind, OpenProjectRequest,
    PrefetchPackagesRequest, RootConfidence,
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

    // `article` (the documentclass) is always in the core bundle, so it must never show up as
    // fetched or failed. `media9` (deliberately not in core) may or may not need a real fetch
    // depending on whether an earlier test run already cached it on this machine -- caching is
    // permanent by design (4.2), so this test has to be robust to running on an already-warm
    // cache rather than assuming a fresh one. It must not, however, have genuinely failed.
    assert!(!resp.fetched.iter().any(|f| f.name == "article"), "{:?}", resp.fetched);
    assert!(!resp.failed.contains(&"article".to_string()), "{:?}", resp.failed);
    assert!(!resp.failed.contains(&"media9".to_string()), "media9 fetch failed: {:?}", resp.failed);
    if let Some(media9) = resp.fetched.iter().find(|f| f.name == "media9") {
        assert!(media9.bytes > 0, "media9 was fetched but reported 0 bytes");
    }

    // Second call: whatever the first call needed (if anything) is cached now, so this must
    // report nothing missing at all -- the actual point of prefetch persisting to cache.
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

    // Never a raw, untranslated "File `...' not found" -- the missing-package diagnostic must
    // still be the plain-English one from 3.10, not a fallback raw dump.
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

/// Task 4.9, wired end to end through the real RPC handler rather than `system_tex::compile()`
/// directly (see `tests/system_tex.rs` for that) -- proves `handlers::compile()`'s own
/// `engine: System` branch actually resolves the root document's shadow-dir-relative path
/// correctly and produces a normal `status: Ok` response, same shape as the Tectonic path.
/// Skips (doesn't fail) on a machine with no system TeX install -- `system_tex::detect()`
/// returning `None` there is expected, not a bug.
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
