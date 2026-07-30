//! Isolated in its own file (a separate test binary/process) specifically so its
//! `TECTONIC_CACHE_DIR` override can't race with other test files' use of the real, unisolated
//! cache -- same reasoning as `network_disabled.rs`'s own env-var trick living in its own file.
//! Everything lives in one `#[test]` function: `std::env::set_var` is process-global, so splitting
//! this into several parallel tests in the same binary would race on it.

use quire_core::rpc::handlers::{bundle_status, install_package, list_installed_packages, remove_package};
use quire_core::rpc::{InstallPackageRequest, PackageSource, RemovePackageRequest};

#[test]
fn package_manager_lists_installs_and_removes_against_an_isolated_cache() {
    let cache_dir = std::env::temp_dir().join(format!("quire-core-package-manager-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cache_dir);
    std::env::set_var("TECTONIC_CACHE_DIR", &cache_dir);

    // A fresh, isolated cache still lists core's own curated packages (task 4.1's manifest) --
    // core doesn't live in the cache tier at all.
    let before = list_installed_packages();
    assert!(before.iter().any(|p| p.name == "amsmath" && p.source == PackageSource::Core));
    assert!(!before.iter().any(|p| p.name == "media9"));

    // `media9` is 4.3/4.4's own go-to example of a real, resolvable non-core package -- installing
    // it here goes through the exact same `bundle::fetch` those tasks already exercise.
    let fetched = install_package(&InstallPackageRequest { name: "media9".to_string() }).expect("media9 should resolve");
    assert_eq!(fetched.name, "media9");
    assert!(fetched.bytes > 0);

    let after_install = list_installed_packages();
    let installed = after_install.iter().find(|p| p.name == "media9").expect("media9 should now be listed");
    assert_eq!(installed.source, PackageSource::Cache);
    assert_eq!(installed.bytes, Some(fetched.bytes));

    let status = bundle_status().expect("bundle_status should succeed");
    assert!(status.cache_bytes > 0, "cache_bytes should reflect the real fetch, got {}", status.cache_bytes);
    assert!(status.offline_packages as usize >= after_install.len());

    remove_package(&RemovePackageRequest { name: "media9".to_string() }).expect("remove should succeed");

    let after_remove = list_installed_packages();
    assert!(!after_remove.iter().any(|p| p.name == "media9"), "{:?}", after_remove);

    // Removing a name that was never cached (e.g. a core-only name, or one already removed) is
    // success, not an error -- same "already gone" precedent as `bundle::fetch`.
    remove_package(&RemovePackageRequest { name: "media9".to_string() }).expect("removing twice should still succeed");

    let _ = std::fs::remove_dir_all(&cache_dir);
}
