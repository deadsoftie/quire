use std::path::PathBuf;

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
/// permanently on success. `Ok` also covers "turned out to already be available" -- callers that
/// only care about genuinely new fetches should check `missing_from_cache` first.
pub fn fetch(name: &str) -> Result<(), CompileError> {
    let mut status = NoopStatusBackend::default();
    let mut bundle = resolve_bundle()?;
    match bundle.input_open_name(name, &mut status) {
        OpenResult::Ok(_) => Ok(()),
        OpenResult::NotAvailable => Err(CompileError { message: format!("{name} was not found in any bundle"), log: None }),
        OpenResult::Err(e) => Err(CompileError { message: e.to_string(), log: None }),
    }
}
