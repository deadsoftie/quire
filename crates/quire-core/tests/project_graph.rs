use quire_core::project::{build_file_graph, FileKind, IncludeCommand};
use std::path::Path;

fn fixture_root() -> std::path::PathBuf {
    Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/project_graph"
    ))
    .join("main.tex")
}

#[test]
fn resolves_a_real_multi_file_project_fully() {
    let root = fixture_root();
    let base_dir = root.parent().unwrap();
    let graph = build_file_graph(&root);

    assert_eq!(graph.root, root);

    let tex_paths: Vec<&Path> = graph
        .files
        .iter()
        .filter(|f| f.kind == FileKind::Tex)
        .map(|f| f.path.as_path())
        .collect();

    assert!(tex_paths.contains(&root.as_path()));
    assert!(tex_paths.contains(&base_dir.join("chapters/intro.tex").as_path()));
    assert!(tex_paths.contains(&base_dir.join("chapters/middle.tex").as_path()));
    assert!(
        tex_paths.contains(&base_dir.join("chapters/nested.tex").as_path()),
        "chapters/nested.tex should be reachable transitively via intro.tex's \\subfile"
    );
    assert_eq!(
        tex_paths.len(),
        4,
        "no extra/duplicate tex nodes: {tex_paths:?}"
    );

    let graphic_paths: Vec<&Path> = graph
        .files
        .iter()
        .filter(|f| f.kind == FileKind::Graphic)
        .map(|f| f.path.as_path())
        .collect();
    assert_eq!(
        graphic_paths,
        vec![base_dir.join("figures/plot.pdf").as_path()]
    );

    assert!(!tex_paths.contains(&base_dir.join("chapters/commented_out.tex").as_path()));
    assert!(!tex_paths.contains(
        &base_dir
            .join("chapters/should_not_be_followed.tex")
            .as_path()
    ));

    let unresolved = graph.unresolved();
    assert_eq!(unresolved.len(), 2, "{unresolved:?}");
    assert!(unresolved
        .iter()
        .any(|r| r.command == IncludeCommand::IncludeGraphics && r.raw_arg == "figures/missing"));
    assert!(unresolved
        .iter()
        .any(|r| r.command == IncludeCommand::DocumentClass && r.raw_arg == "article"));
}

#[test]
fn main_tex_references_are_recorded_with_the_right_commands() {
    let root = fixture_root();
    let graph = build_file_graph(&root);

    let main_node = graph.files.iter().find(|f| f.path == root).unwrap();
    let commands: Vec<IncludeCommand> = main_node.references.iter().map(|r| r.command).collect();

    assert_eq!(
        commands,
        vec![
            IncludeCommand::DocumentClass,
            IncludeCommand::Input,
            IncludeCommand::Include,
            IncludeCommand::IncludeGraphics,
            IncludeCommand::IncludeGraphics,
        ]
    );
}
