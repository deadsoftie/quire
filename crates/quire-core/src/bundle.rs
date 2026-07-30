use std::fs;
use std::io::Read;
use std::path::PathBuf;

use serde::Deserialize;
use tectonic::io::{InputHandle, IoProvider, OpenResult};
use tectonic::status::{NoopStatusBackend, StatusBackend};
use tectonic_bundles::{dir::DirBundle, Bundle};

use crate::CompileError;

/// Resolved relative to this crate's own manifest dir -- the only path that's actually correct
/// today. A packaged app (task 4.12) will need its own resolution for wherever the bundle
/// actually ships; this is the one place that future change has to touch.
fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

fn open_network_bundle() -> Result<Box<dyn Bundle>, CompileError> {
    let config = tectonic::config::PersistentConfig::open(false)?;
    Ok(config.default_bundle(false)?)
}

/// Chains the curated, offline core bundle in front of Tectonic's own network-fetching bundle.
/// That network bundle already caches every file it ever fetches to local disk and only hits
/// the network again on a genuine cache miss (`tectonic_bundles::cache::BundleCache`) -- so this
/// is the real three-tier resolution (bundle -> cache -> network) in a single chain, not three
/// paths every caller has to try in order itself.
///
/// The network tier is constructed lazily, on the first name core doesn't have -- never eagerly.
/// Eagerly constructing it would defeat the whole point: a document core fully covers must
/// never require network access (or even a pre-existing local cache) to compile, matching 4.1's
/// "compiles fully offline from a clean install" bar.
struct TieredBundle {
    core: Box<dyn Bundle>,
    network: Option<Box<dyn Bundle>>,
}

impl TieredBundle {
    fn network_mut(&mut self) -> Result<&mut Box<dyn Bundle>, CompileError> {
        if self.network.is_none() {
            self.network = Some(open_network_bundle()?);
        }
        Ok(self.network.as_mut().unwrap())
    }
}

impl IoProvider for TieredBundle {
    fn input_open_name(&mut self, name: &str, status: &mut dyn StatusBackend) -> OpenResult<InputHandle> {
        match self.core.input_open_name(name, status) {
            OpenResult::NotAvailable => {}
            other => return other,
        }

        match self.network_mut() {
            Ok(network) => network.input_open_name(name, status),
            Err(e) => OpenResult::Err(tectonic::Error::msg(e.message)),
        }
    }
}

impl Bundle for TieredBundle {
    fn get_digest(&mut self) -> tectonic::Result<tectonic::io::digest::DigestData> {
        // The core bundle defines this compile's identity (and 4.6's future version-pinning) --
        // an amalgam with whatever the network tier happens to also serve wouldn't be stable.
        self.core.get_digest()
    }

    fn all_files(&self) -> Vec<String> {
        self.core.all_files()
    }
}

/// Prefers the curated core bundle (built by the `build_core_bundle` example from
/// `bundles/manifest.json`) when it's present, falling back to Tectonic's own network-fetching
/// default entirely when it's not -- so a fresh clone that hasn't run that example yet still
/// compiles, just not offline.
pub fn resolve_bundle() -> Result<Box<dyn Bundle>, CompileError> {
    let core_dir = core_bundle_dir();
    if core_dir.join("SHA256SUM").is_file() {
        let core: Box<dyn Bundle> = Box::new(DirBundle::new(core_dir));
        return Ok(Box::new(TieredBundle { core, network: None }));
    }

    open_network_bundle()
}

/// The subset of `candidates` that can't be resolved right now without touching the network --
/// neither from the curated core bundle nor from a prior fetch already sitting in local cache.
/// This is the "diff against bundle + cache" step task 4.3 (prefetch) needs before it fetches
/// anything -- checked here with the network tier forced into cache-only mode, so calling this
/// never itself triggers a fetch, unlike `resolve_bundle()`'s own normal (network-allowed) path.
pub fn missing_from_cache(candidates: &[String]) -> Vec<String> {
    let mut status = NoopStatusBackend::default();

    let core_dir = core_bundle_dir();
    let mut core: Option<DirBundle> = core_dir.join("SHA256SUM").is_file().then(|| DirBundle::new(core_dir));

    let mut cache_only: Option<Box<dyn Bundle>> =
        tectonic::config::PersistentConfig::open(false).ok().and_then(|config| config.default_bundle(true).ok());

    candidates
        .iter()
        .filter(|name| {
            let in_core = core.as_mut().is_some_and(|b| matches!(b.input_open_name(name, &mut status), OpenResult::Ok(_)));
            if in_core {
                return false;
            }
            !cache_only.as_mut().is_some_and(|b| matches!(b.input_open_name(name, &mut status), OpenResult::Ok(_)))
        })
        .cloned()
        .collect()
}

/// Actually fetches `name` through the normal bundle -> cache -> network chain, caching it
/// permanently on success, and returns its size in bytes -- the real number the missing-package
/// card (task 4.4) reports *after* installing, since nothing in Tectonic's `Bundle`/`FileInfo`
/// API exposes a file's size before it's actually been read. `Ok` also covers "turned out to
/// already be available" -- callers that only care about genuinely new fetches should check
/// `missing_from_cache` first.
pub fn fetch(name: &str) -> Result<u64, CompileError> {
    let mut status = NoopStatusBackend::default();
    let mut bundle = resolve_bundle()?;
    match bundle.input_open_name(name, &mut status) {
        OpenResult::Ok(mut handle) => {
            let mut buf = Vec::new();
            handle.read_to_end(&mut buf)?;
            Ok(buf.len() as u64)
        }
        OpenResult::NotAvailable => Err(CompileError { message: format!("{name} was not found in any bundle"), log: None }),
        OpenResult::Err(e) => Err(CompileError { message: e.to_string(), log: None }),
    }
}

/// The network/cache tier's own digest -- deliberately *not* `resolve_bundle()` +
/// `TieredBundle::get_digest()`, which reports core's digest (4.2's own choice, since core
/// defines a compile's identity). The package manager (task 4.5) needs the cache tier's digest
/// specifically, to find *its* on-disk cache directory below.
fn network_bundle_digest_hex() -> Result<String, CompileError> {
    Ok(open_network_bundle()?.get_digest()?.to_string())
}

/// Tectonic's own on-disk cache root for the network bundle tier -- `get_user_cache_dir` is the
/// exact function `tectonic_bundles::cache::BundleCache` uses internally to pick this location
/// (confirmed by reading that crate's source), not a reimplementation of its path logic. Real
/// files live under here at `{name}`, e.g. `tikz.sty` -- not content-hashed blobs.
fn cache_data_dir() -> Result<PathBuf, CompileError> {
    let root = tectonic_io_base::app_dirs::get_user_cache_dir("bundles")?;
    Ok(root.join("data").join(network_bundle_digest_hex()?))
}

#[derive(Deserialize)]
struct CoreManifest {
    #[serde(rename = "documentClasses")]
    document_classes: Vec<String>,
    packages: Vec<String>,
}

/// The curated, human-meaningful list of what core ships (task 4.1's own manifest) -- 18 names a
/// user would recognize from `\usepackage{}`/`\documentclass{}`, not a raw walk of
/// `bundles/core/`'s ~50 flat files, most of which are internal transitive dependencies
/// (`amsbsy.sty`, `amsopn.sty`, ...) nobody ever typed. Empty on a fresh clone that hasn't run
/// `build_core_bundle` yet, matching `resolve_bundle()`'s own graceful fallback.
pub fn core_packages() -> Vec<String> {
    let manifest_path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/manifest.json"));
    let Ok(text) = fs::read_to_string(manifest_path) else { return Vec::new() };
    let Ok(manifest) = serde_json::from_str::<CoreManifest>(&text) else { return Vec::new() };
    let mut names = manifest.document_classes;
    names.extend(manifest.packages);
    names.sort();
    names
}

/// Every `.sty`/`.cls` file actually sitting in the cache tier right now, as `(bare_name, bytes)`
/// -- the real, removable "installed packages" list the manager panel (task 4.5) shows, distinct
/// from `core_packages()`'s fixed, non-removable set. Empty if the cache tier has never been used.
pub fn cached_packages() -> Vec<(String, u64)> {
    let Ok(dir) = cache_data_dir() else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };

    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?.to_string();
            let ext = path.extension()?.to_str()?;
            if ext != "sty" && ext != "cls" {
                return None;
            }
            let bytes = entry.metadata().ok()?.len();
            Some((name, bytes))
        })
        .collect()
}

/// Total bytes the cache tier is actually using on disk -- every file under it, not just the
/// `.sty`/`.cls` subset `cached_packages()` lists (fonts, engine data, etc. land here too), for
/// `bundleStatus().cacheBytes` (task 4.5).
pub fn cache_size_bytes() -> u64 {
    let Ok(dir) = cache_data_dir() else { return 0 };
    fn walk(dir: &std::path::Path) -> u64 {
        let Ok(entries) = fs::read_dir(dir) else { return 0 };
        entries
            .filter_map(|entry| entry.ok())
            .map(|entry| match entry.file_type() {
                Ok(ft) if ft.is_dir() => walk(&entry.path()),
                Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
                Err(_) => 0,
            })
            .sum()
    }
    walk(&dir)
}

/// Removes a cache-tier package by name, trying `{name}.sty` then `{name}.cls`. Not finding
/// either is success, not an error (already gone) -- same "success also covers already-satisfied"
/// precedent as `fetch` above. Never touches `core_packages()`'s files -- those aren't in this
/// directory at all, so there's nothing here for a core name to accidentally match.
pub fn remove_cached_package(name: &str) -> Result<(), CompileError> {
    let dir = cache_data_dir()?;
    for candidate in [format!("{name}.sty"), format!("{name}.cls")] {
        let path = dir.join(candidate);
        if path.is_file() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
