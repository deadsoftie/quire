use std::path::PathBuf;

use tectonic::io::{InputHandle, IoProvider, OpenResult};
use tectonic::status::StatusBackend;
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
