//! Proves task 4.2's three-tier resolution (bundle -> cache -> network) actually holds up with
//! network access genuinely cut, not just structurally guaranteed by reading the code. Cutting
//! network access literally: pointing `HTTPS_PROXY` at a closed local port makes any real fetch
//! attempt fail fast with a connection error, verified empirically against this exact bundle
//! backend (a file already on local disk still resolves `Ok`; a file that genuinely isn't
//! resolves `Err` naming the network problem, not a hang or a silent false positive).
//!
//! Both tiers are exercised in one test, not split across files/threads: `HTTPS_PROXY` is
//! process-global state, and `cargo test` runs everything in one file concurrently by default.

use std::path::PathBuf;

use quire_core::bundle::resolve_bundle;
use tectonic::io::{InputHandle, IoProvider, OpenResult};
use tectonic::status::NoopStatusBackend;

// `OpenResult<InputHandle>` isn't `Debug` (`InputHandle` isn't), so describe it by hand for
// panic messages.
fn describe(result: &OpenResult<InputHandle>) -> &'static str {
    match result {
        OpenResult::Ok(_) => "Ok",
        OpenResult::NotAvailable => "NotAvailable",
        OpenResult::Err(_) => "Err",
    }
}

fn set_network_cut(cut: bool) {
    if cut {
        // Nothing listens here -- any real connection attempt fails immediately.
        std::env::set_var("HTTPS_PROXY", "http://127.0.0.1:1");
        std::env::set_var("https_proxy", "http://127.0.0.1:1");
    } else {
        std::env::remove_var("HTTPS_PROXY");
        std::env::remove_var("https_proxy");
    }
}

fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

#[test]
fn bundle_and_cache_tiers_resolve_files_with_network_disabled() {
    assert!(
        core_bundle_dir().join("SHA256SUM").is_file(),
        "bundles/core/SHA256SUM missing -- run `cargo run -p quire-core --example build_core_bundle` first"
    );

    let mut status = NoopStatusBackend::default();

    // Tier 1: a file the curated core bundle actually ships. This must never require network
    // (or even a pre-existing cache) at all -- it's what 4.1's "clean install" bar depends on.
    set_network_cut(true);
    let mut bundle = resolve_bundle().expect("resolve_bundle should not need network for this");
    let result = bundle.input_open_name("article.cls", &mut status);
    if !matches!(result, OpenResult::Ok(_)) {
        panic!("article.cls (in bundles/core) should resolve with network cut, got {}", describe(&result));
    }
    drop(bundle);

    // Tier 2 (cache): a file core deliberately excludes (`tikz.sty` -- see manifest.json's
    // `excluded` section). Warm the cache for it with network allowed first, then prove a fresh
    // resolution reuses the cache without needing network again.
    set_network_cut(false);
    let mut bundle = resolve_bundle().expect("resolve_bundle with network allowed");
    let result = bundle.input_open_name("tikz.sty", &mut status);
    if !matches!(result, OpenResult::Ok(_)) {
        panic!("tikz.sty should be fetchable over the network to warm the cache, got {}", describe(&result));
    }
    drop(bundle);

    set_network_cut(true);
    let mut bundle = resolve_bundle().expect("resolve_bundle should not need network to construct");
    let result = bundle.input_open_name("tikz.sty", &mut status);
    set_network_cut(false);
    if !matches!(result, OpenResult::Ok(_)) {
        panic!("tikz.sty should resolve from the warmed cache with network cut, got {}", describe(&result));
    }
}
