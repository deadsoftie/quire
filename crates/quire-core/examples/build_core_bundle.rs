//! Compiles the fixtures in `examples/fixtures/core_bundle_discovery/` -- plus, as of task 4.8,
//! the real shipped templates in `templates/` -- against Tectonic's real (network/cache-backed)
//! default bundle while logging every filename it resolves, then copies that observed file
//! closure into `bundles/core/` as a flat directory bundle.
//!
//! Run with: cargo run -p quire-core --example build_core_bundle
//!
//! Re-run whenever `bundles/manifest.json` changes. The `core_bundle_discovery/` fixtures are
//! deliberately kept alongside the real templates, not replaced by them: the real templates are
//! intentionally minimal (a clean starting point, not a showcase), so several manifest packages
//! (`xcolor`, `booktabs`, `enumitem`, `natbib`+citations, `amsthm`) are only ever exercised by the
//! kitchen-sink `article.tex` fixture -- dropping it would silently drop their files from
//! `bundles/core/` even though the manifest still lists them.

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use tectonic::config::PersistentConfig;
use tectonic::driver::{OutputFormat, PassSetting, ProcessingSessionBuilder};
use tectonic::io::{digest, InputHandle, IoProvider, OpenResult};
use tectonic::status::{NoopStatusBackend, StatusBackend};
use tectonic_bundles::Bundle;

use quire_core::rerun::compile_latex_in_dir_with_bundle;
use quire_core::CompileError;

const FIXTURES: &[(&str, &[&str])] = &[
    ("bare_article.tex", &[]),
    ("article.tex", &["article_refs.bib"]),
    ("bibtex_plain.tex", &["article_refs.bib"]),
    ("report.tex", &[]),
    ("book.tex", &[]),
    ("beamer.tex", &[]),
    ("ieee.tex", &[]),
    ("acm.tex", &[]),
];

/// Task 4.8's real, user-facing starter documents -- see the module doc comment for why these
/// are discovered *in addition to*, not instead of, the fixtures above.
const TEMPLATES: &[&str] = &["article.tex", "ieee.tex", "acm.tex", "beamer.tex"];

struct LoggingBundle {
    inner: Box<dyn Bundle>,
    seen: Rc<RefCell<BTreeSet<String>>>,
}

impl IoProvider for LoggingBundle {
    fn input_open_name(&mut self, name: &str, status: &mut dyn StatusBackend) -> OpenResult<InputHandle> {
        let result = self.inner.input_open_name(name, status);
        if matches!(result, OpenResult::Ok(_)) {
            self.seen.borrow_mut().insert(name.to_string());
        }
        result
    }
}

impl Bundle for LoggingBundle {
    fn get_digest(&mut self) -> tectonic::Result<digest::DigestData> {
        self.inner.get_digest()
    }

    fn all_files(&self) -> Vec<String> {
        self.inner.all_files()
    }
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/examples/fixtures/core_bundle_discovery"))
}

fn templates_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../templates"))
}

fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

fn open_default_bundle() -> Box<dyn Bundle> {
    let config = PersistentConfig::open(false).expect("open tectonic config");
    config.default_bundle(false).expect("open default bundle")
}

/// A from-scratch clean install has no cached `.fmt` file, and Tectonic keys its format cache by
/// bundle digest -- so `bundles/core`'s own (different-from-network-bundle) digest would force a
/// from-scratch format rebuild the first time anyone compiles against it. That rebuild reads
/// `tectonic-format-latex.tex` (the LaTeX kernel's initex entry point) and everything it in turn
/// `\input`s, none of which a normal document-compiling pass ever touches since it just reuses an
/// already-built format. Forcing that rebuild here, against a throwaway format cache dir, is the
/// only way to discover that closure too.
fn prime_format_cache(bundle_factory: &dyn Fn() -> Result<Box<dyn Bundle>, CompileError>) {
    let scratch_cache = std::env::temp_dir()
        .join(format!("quire-core-build-core-bundle-fmtcache-{}", std::process::id()));
    let build_dir = std::env::temp_dir()
        .join(format!("quire-core-build-core-bundle-fmtprime-{}", std::process::id()));
    let _ = fs::remove_dir_all(&scratch_cache);
    let _ = fs::remove_dir_all(&build_dir);
    fs::create_dir_all(&scratch_cache).expect("create scratch format cache dir");
    fs::create_dir_all(&build_dir).expect("create build dir");

    let bundle = bundle_factory().expect("open bundle for format priming");
    let mut status = NoopStatusBackend::default();
    let mut sb = ProcessingSessionBuilder::default();
    sb.bundle(bundle)
        .primary_input_buffer(b"\\documentclass{article}\\begin{document}x\\end{document}")
        .tex_input_name("texput.tex")
        .format_name("latex")
        .format_cache_path(&scratch_cache)
        .filesystem_root(&build_dir)
        .output_dir(&build_dir)
        .keep_intermediates(true)
        .keep_logs(false)
        .print_stdout(false)
        .output_format(OutputFormat::Xdv)
        .pass(PassSetting::Tex);

    let mut sess = sb.create(&mut status).expect("create format-priming session");
    sess.run(&mut status).expect("prime format cache");

    let _ = fs::remove_dir_all(&scratch_cache);
    let _ = fs::remove_dir_all(&build_dir);
}

type BundleFactory = dyn Fn() -> Result<Box<dyn Bundle>, CompileError>;

fn compile_one(source_dir: &Path, name: &str, extra_files: &[&str], bundle_factory: &BundleFactory) {
    let source_path = source_dir.join(name);
    let source =
        fs::read_to_string(&source_path).unwrap_or_else(|e| panic!("reading {}: {e}", source_path.display()));

    let build_dir = std::env::temp_dir().join(format!(
        "quire-core-build-core-bundle-{}-{}",
        name.trim_end_matches(".tex"),
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&build_dir);
    fs::create_dir_all(&build_dir).expect("create build dir");
    for extra in extra_files {
        fs::copy(source_dir.join(extra), build_dir.join(extra)).unwrap_or_else(|e| panic!("copying dependency {extra}: {e}"));
    }

    println!("compiling {name}...");
    let result = compile_latex_in_dir_with_bundle(&source, &build_dir, bundle_factory);
    let _ = fs::remove_dir_all(&build_dir);
    result.unwrap_or_else(|e| panic!("compiling {name}: {}", e.log.as_deref().unwrap_or(&e.message)));
}

fn discover() -> BTreeSet<String> {
    let seen: Rc<RefCell<BTreeSet<String>>> = Rc::new(RefCell::new(BTreeSet::new()));
    let factory_seen = Rc::clone(&seen);
    let bundle_factory = move || -> Result<Box<dyn Bundle>, CompileError> {
        Ok(Box::new(LoggingBundle { inner: open_default_bundle(), seen: Rc::clone(&factory_seen) }) as Box<dyn Bundle>)
    };

    println!("priming format cache (forces a from-scratch LaTeX format build to discover its file closure)...");
    prime_format_cache(&bundle_factory);

    for (name, extra_files) in FIXTURES {
        compile_one(&fixtures_dir(), name, extra_files, &bundle_factory);
    }
    for name in TEMPLATES {
        compile_one(&templates_dir(), name, &[], &bundle_factory);
    }

    // bundle_factory holds the other clone of `seen`; drop it so try_unwrap below succeeds.
    drop(bundle_factory);
    Rc::try_unwrap(seen).expect("no other references left").into_inner()
}

/// `DirBundle` is flat, so every discovered name collapses to its basename -- this is where a
/// real collision (two different subpaths sharing a basename) would surface.
fn assemble(discovered: &BTreeSet<String>, core_dir: &Path) {
    let mut by_basename: HashMap<String, String> = HashMap::new();
    for name in discovered {
        let basename = Path::new(name)
            .file_name()
            .unwrap_or_else(|| panic!("discovered name has no basename: {name}"))
            .to_string_lossy()
            .into_owned();
        if let Some(prior) = by_basename.insert(basename.clone(), name.clone()) {
            panic!("basename collision copying into flat bundles/core/: {prior:?} and {name:?} both map to {basename:?}");
        }
    }

    fs::create_dir_all(core_dir).expect("create bundles/core");
    let mut source_bundle = open_default_bundle();
    let mut status = NoopStatusBackend::default();
    let mut hasher = digest::create();

    for (basename, original_name) in by_basename.iter().collect::<std::collections::BTreeMap<_, _>>() {
        match source_bundle.input_open_name(original_name, &mut status) {
            OpenResult::Ok(mut handle) => {
                let mut data = Vec::new();
                handle.read_to_end(&mut data).unwrap_or_else(|e| panic!("reading {original_name}: {e}"));
                digest::Digest::update(&mut hasher, &data);
                fs::write(core_dir.join(basename), data).unwrap_or_else(|e| panic!("writing {basename}: {e}"));
            }
            OpenResult::NotAvailable => panic!("bundle no longer has {original_name} on a second open"),
            OpenResult::Err(e) => panic!("reopening {original_name}: {e}"),
        }
    }

    let digest = digest::DigestData::from(hasher);
    fs::write(core_dir.join("SHA256SUM"), digest.to_string()).expect("write SHA256SUM");

    println!("wrote {} files to {}", by_basename.len(), core_dir.display());
}

fn main() {
    let discovered = discover();
    println!("discovered {} files", discovered.len());
    assemble(&discovered, &core_bundle_dir());
}
