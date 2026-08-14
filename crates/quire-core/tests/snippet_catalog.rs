//! Proves every entry in the SnippetsPanel catalog is real, compilable LaTeX - catches a typo or
//! unbalanced brace the same way task 4.8 caught a real bug in the acmart template, before it ever
//! reaches a user dragging the card into their own document.

use std::fs;
use std::path::{Path, PathBuf};

use regex::{Captures, Regex};
use serde::Deserialize;

use quire_core::bundle::resolve_bundle;
use quire_core::rerun::compile_latex_in_dir_with_bundle;

#[derive(Deserialize)]
struct SnippetEntry {
    id: String,
    template: String,
    #[serde(rename = "requiresPackage")]
    requires_package: Option<String>,
}

fn catalog() -> Vec<SnippetEntry> {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/ui/src/data/snippet-library.json"));
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parsing {}: {e}", path.display()))
}

/// Mirrors the CM6 tabstop dialect shared with 3.7's snippets.ts: `${1:placeholder}` -> "placeholder", `${1}` -> "".
fn substitute_tabstops(template: &str) -> String {
    let tabstop = Regex::new(r"\$\{\d+(?::([^}]*))?\}").unwrap();
    tabstop
        .replace_all(template, |caps: &Captures| caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string())
        .into_owned()
}

/// Baseline packages every wrapped test document loads regardless of the entry's own `requiresPackage` --
/// mirrors 4.1's own kitchen-sink discovery fixture precedent, and covers what several entries need
/// structurally (amsmath's align/gather/cases/pmatrix, graphicx's includegraphics) without every one of
/// them having to declare a hint for a package this codebase already treats as part of the core baseline.
const BASELINE_PACKAGES: &[&str] = &["amsmath", "amssymb", "graphicx", "hyperref", "xcolor", "geometry", "booktabs"];

fn wrapped_source(entry: &SnippetEntry) -> String {
    let body = substitute_tabstops(&entry.template);

    let class = if entry.requires_package.as_deref() == Some("beamer") { "beamer" } else { "article" };
    let mut preamble = String::new();
    for pkg in BASELINE_PACKAGES {
        preamble.push_str(&format!("\\usepackage{{{pkg}}}\n"));
    }

    match entry.requires_package.as_deref() {
        None | Some("beamer") => {}
        // amsthm doesn't predefine theorem/lemma/definition environments on its own - each has to be
        // declared with \newtheorem, same as any real document using it would.
        Some("amsthm") => {
            preamble.push_str(
                "\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\newtheorem{lemma}{Lemma}\n\\newtheorem{definition}{Definition}\n",
            );
        }
        Some(pkg) => preamble.push_str(&format!("\\usepackage{{{pkg}}}\n")),
    }

    // A snippet on its own (e.g. an \author block with no \maketitle) can leave the document with
    // zero shipped pages - real documents always have surrounding content forcing real output;
    // this filler line stands in for that so the test measures the snippet, not an artifact of
    // testing it in isolation. Skipped for beamer: loose text outside a \begin{frame} block isn't
    // valid there, and every beamer entry already provides its own frame (real output) anyway.
    let filler = if class == "beamer" { "" } else { "Filler text.\n\n" };
    format!("\\documentclass{{{class}}}\n{preamble}\\begin{{document}}\n{filler}{body}\n\\end{{document}}\n")
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB88320 & mask);
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    const MOD_ADLER: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % MOD_ADLER;
        b = (b + a) % MOD_ADLER;
    }
    (b << 16) | a
}

fn png_chunk(chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut type_and_data = chunk_type.to_vec();
    type_and_data.extend_from_slice(data);
    let mut chunk = Vec::new();
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(&type_and_data);
    chunk.extend_from_slice(&crc32(&type_and_data).to_be_bytes());
    chunk
}

/// A hand-built 1x1 grayscale PNG - no image-encoding crate exists in this dependency tree, and every
/// byte here (CRC32, Adler32, zlib stored block) is computed, not copied from memory, so it's guaranteed
/// spec-valid rather than hoping a remembered magic byte sequence happens to be right.
fn tiny_png() -> Vec<u8> {
    let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&[8, 0, 0, 0, 0]);
    png.extend(png_chunk(b"IHDR", &ihdr));

    let raw = [0x00u8, 0x00u8];
    let mut zlib = vec![0x78, 0x01, 0x01];
    zlib.extend_from_slice(&(raw.len() as u16).to_le_bytes());
    zlib.extend_from_slice(&(!(raw.len() as u16)).to_le_bytes());
    zlib.extend_from_slice(&raw);
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    png.extend(png_chunk(b"IDAT", &zlib));

    png.extend(png_chunk(b"IEND", &[]));
    png
}

/// figure/subfigures/wrapfigure reference a placeholder path via \includegraphics - a real file has to
/// exist for those three to compile past that line, the same constraint any real document has.
fn write_placeholder_images(build_dir: &Path, body: &str) {
    let re = Regex::new(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}").unwrap();
    for caps in re.captures_iter(body) {
        let name = &caps[1];
        let _ = fs::write(build_dir.join(format!("{name}.png")), tiny_png());
    }
}

#[test]
fn every_snippet_compiles_clean() {
    assert!(
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core/SHA256SUM")).is_file(),
        "bundles/core/SHA256SUM missing - run `cargo run -p quire-core --example build_core_bundle` first"
    );

    let entries = catalog();
    assert!(!entries.is_empty(), "snippet-library.json parsed to zero entries");

    let mut failures = Vec::new();
    for entry in &entries {
        let source = wrapped_source(entry);
        let build_dir = std::env::temp_dir().join(format!("quire-core-snippet-catalog-{}-{}", entry.id, std::process::id()));
        let _ = fs::remove_dir_all(&build_dir);
        fs::create_dir_all(&build_dir).expect("create build dir");
        write_placeholder_images(&build_dir, &source);

        let result = compile_latex_in_dir_with_bundle(&source, &build_dir, &resolve_bundle);
        let _ = fs::remove_dir_all(&build_dir);

        match result {
            Ok(out) if out.pdf.starts_with(b"%PDF-") => {}
            Ok(_) => failures.push(format!("{}: compiled but produced no valid PDF", entry.id)),
            Err(e) => failures.push(format!("{}: {}", entry.id, e.log.as_deref().unwrap_or(&e.message))),
        }
    }

    assert!(failures.is_empty(), "snippet catalog entries failed to compile:\n{}", failures.join("\n---\n"));
}
