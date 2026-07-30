use std::path::PathBuf;

use tectonic_bundles::{dir::DirBundle, Bundle};

use crate::CompileError;

/// Resolved relative to this crate's own manifest dir -- the only path that's actually correct
/// today. A packaged app (task 4.12) will need its own resolution for wherever the bundle
/// actually ships; this is the one place that future change has to touch.
fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

/// Prefers the curated core bundle (built by the `build_core_bundle` example from
/// `bundles/manifest.json`) when it's present, falling back to Tectonic's own network-fetching
/// default otherwise -- so a fresh clone that hasn't run that example yet still compiles, just
/// not offline. This is deliberately not the full bundle-then-cache-then-network cascade.
pub fn resolve_bundle() -> Result<Box<dyn Bundle>, CompileError> {
    let core_dir = core_bundle_dir();
    if core_dir.join("SHA256SUM").is_file() {
        return Ok(Box::new(DirBundle::new(core_dir)));
    }

    let config = tectonic::config::PersistentConfig::open(false)?;
    Ok(config.default_bundle(false)?)
}
