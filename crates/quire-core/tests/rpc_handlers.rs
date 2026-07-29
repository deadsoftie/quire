use std::fs;
use std::path::{Path, PathBuf};

use quire_core::rpc::handlers::{compile, open_project};
use quire_core::rpc::{CompileReason, CompileRequest, CompileStatus, DirtyBuffer, FileNodeKind, OpenProjectRequest, RootConfidence};

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
fn compile_mirrors_the_whole_graph_and_produces_a_real_pdf() {
    let project_dir = fresh_project_copy("compile_multi_file", "compile-basic");

    let resp = compile(&CompileRequest {
        project_id: project_dir.display().to_string(),
        dirty_buffers: Vec::new(),
        reason: CompileReason::Manual,
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

#[test]
fn dirty_buffer_on_a_non_root_subfile_is_honored_and_changes_are_detected() {
    let project_dir = fresh_project_copy("compile_multi_file", "compile-dirty");
    let project_id = project_dir.display().to_string();

    compile(&CompileRequest { project_id: project_id.clone(), dirty_buffers: Vec::new(), reason: CompileReason::Open })
        .expect("first compile should succeed");

    let intro_uri = project_dir.join("chapters/intro.tex").display().to_string();
    let resp = compile(&CompileRequest {
        project_id: project_id.clone(),
        dirty_buffers: vec![DirtyBuffer {
            uri: intro_uri,
            text: "Edited intro content, not what's on disk.\n".to_string(),
        }],
        reason: CompileReason::Edit,
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
