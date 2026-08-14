//! Isolated in its own file so its `TECTONIC_CACHE_DIR` override can't race with other tests' use of the real cache.

use quire_core::rpc::handlers::{bundle_status, install_package, list_installed_packages, remove_package};
use quire_core::rpc::{InstallPackageRequest, PackageSource, RemovePackageRequest};

#[test]
fn package_manager_lists_installs_and_removes_against_an_isolated_cache() {
    let cache_dir = std::env::temp_dir().join(format!("quire-core-package-manager-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&cache_dir);
    std::env::set_var("TECTONIC_CACHE_DIR", &cache_dir);

    // A fresh, isolated cache still lists core's own curated packages - core isn't in the cache tier.
    let before = list_installed_packages();
    assert!(before.iter().any(|p| p.name == "amsmath" && p.source == PackageSource::Core));
    assert!(!before.iter().any(|p| p.name == "media9"));

    // `media9` is a real, resolvable non-core package, going through the same `bundle::fetch` path.
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

    // Removing a name never cached is success, not an error - same "already gone" precedent as fetch.
    remove_package(&RemovePackageRequest { name: "media9".to_string() }).expect("removing twice should still succeed");

    let _ = std::fs::remove_dir_all(&cache_dir);
}
