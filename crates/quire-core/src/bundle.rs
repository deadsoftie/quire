use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tectonic::io::{InputHandle, IoProvider, OpenResult};
use tectonic::status::{NoopStatusBackend, StatusBackend};
use tectonic_bundles::{dir::DirBundle, Bundle};

use crate::CompileError;

/// Resolved relative to this crate's manifest dir; a packaged app will need a different path.
fn core_bundle_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/core"))
}

fn open_network_bundle() -> Result<Box<dyn Bundle>, CompileError> {
    let config = tectonic::config::PersistentConfig::open(false)?;
    Ok(config.default_bundle(false)?)
}

/// Chains the offline core bundle in front of Tectonic's network bundle, built lazily so a fully-core-covered compile never touches the network.
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
        // Core's digest defines the compile's identity; mixing in the network tier's is unstable.
        self.core.get_digest()
    }

    fn all_files(&self) -> Vec<String> {
        self.core.all_files()
    }
}

/// Falls back to Tectonic's network bundle when the curated core bundle hasn't been built yet.
pub fn resolve_bundle() -> Result<Box<dyn Bundle>, CompileError> {
    let core_dir = core_bundle_dir();
    if core_dir.join("SHA256SUM").is_file() {
        let core: Box<dyn Bundle> = Box::new(DirBundle::new(core_dir));
        return Ok(Box::new(TieredBundle { core, network: None }));
    }

    open_network_bundle()
}

/// The subset of `candidates` resolvable neither from the core bundle nor the local cache; never itself triggers a fetch.
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

/// Fetches and permanently caches `name`, returning its byte size; `Ok` also covers "already available".
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

/// The network/cache tier's own digest, distinct from `TieredBundle`'s, needed to locate its own cache dir.
fn network_bundle_digest_hex() -> Result<String, CompileError> {
    Ok(open_network_bundle()?.get_digest()?.to_string())
}

/// Tectonic's own on-disk cache root for the network bundle tier; files live here by bare name.
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

/// The curated, human-meaningful package/class names core ships; empty until `build_core_bundle` has run.
pub fn core_packages() -> Vec<String> {
    let manifest_path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../bundles/manifest.json"));
    let Ok(text) = fs::read_to_string(manifest_path) else { return Vec::new() };
    let Ok(manifest) = serde_json::from_str::<CoreManifest>(&text) else { return Vec::new() };
    let mut names = manifest.document_classes;
    names.extend(manifest.packages);
    names.sort();
    names
}

/// Removable `.sty`/`.cls` files actually sitting in the cache tier, distinct from `core_packages()`'s fixed set.
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

/// Total on-disk bytes used by the cache tier, not just the `.sty`/`.cls` subset `cached_packages()` lists.
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

/// Removes a cached `.sty`/`.cls` by name; not found is success, not an error.
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

/// The active bundle's digest, hex-formatted, for both status reporting and the version pin below.
pub fn digest_hex() -> Result<String, CompileError> {
    let mut bundle = resolve_bundle()?;
    Ok(bundle.get_digest()?.to_string())
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectMetadata {
    #[serde(default)]
    bundle_version: Option<String>,
}

fn project_metadata_path(project_dir: &Path) -> PathBuf {
    project_dir.join(".quire").join("project.json")
}

/// Compares the pinned bundle version against the current one, returns a notice on mismatch, then re-pins either way.
pub fn record_version_pin(project_dir: &Path) -> Option<String> {
    let Ok(current) = digest_hex() else { return None };

    let path = project_metadata_path(project_dir);
    let previous = fs::read_to_string(&path).ok().and_then(|text| serde_json::from_str::<ProjectMetadata>(&text).ok());

    let notice = match previous.as_ref().and_then(|m| m.bundle_version.as_deref()) {
        Some(pinned) if pinned != current => {
            Some("The package bundle has changed since this project was last opened.".to_string())
        }
        _ => None,
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let metadata = ProjectMetadata { bundle_version: Some(current) };
    if let Ok(text) = serde_json::to_string_pretty(&metadata) {
        let _ = fs::write(&path, text);
    }

    notice
}
