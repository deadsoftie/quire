# Packages & bundles

How Quire resolves LaTeX package files (`.sty`/`.cls`/`.def`/`.fd`/fonts/`.bst`) without
requiring a full TeX Live install, and how it stays offline-capable by default.

## Three-tier resolution (`bundle.rs`)

`resolve_bundle()` is one fallback chain, not three paths every caller tries in order:

1. **`bundles/core/`** — a curated, offline bundle. Always available, zero network,
   ever, once built.
2. **Cache** — anything ever fetched before, permanently on local disk (Tectonic's own
   `BundleCache`, keyed by content digest).
3. **Network** — Tectonic's own network-fetching default bundle.

Tiers 2 and 3 are actually one object — Tectonic's network bundle already checks its
disk cache before touching the network, fetching only on a genuine cache miss.
`TieredBundle` (in `bundle.rs`) just chains tier 1 in front of it, and — critically —
**constructs the network tier lazily**, only on the first name tier 1 doesn't have.
Constructing it eagerly would mean every compile depends on *something* (network, or a
prior cache) existing, defeating the actual goal: a document tier 1 fully covers must
compile with nothing else present. `tests/network_disabled.rs` proves this for real, by
cutting network access and confirming a core-covered file still resolves.

## Building `bundles/core/`

Two-stage, because a package *name* isn't a file — `\usepackage{amsmath}` alone pulls
in many transitive files, and Tectonic can read a bundle but can't build one:

1. **`bundles/manifest.json`** — hand-curated intent: which document classes, packages,
   BibTeX styles, babel languages, font families should be in core, plus an `excluded`
   section documenting what was deliberately left out and why.
2. **`cargo run -p quire-core --example build_core_bundle`** — actually compiles a set
   of fixtures (`crates/quire-core/examples/fixtures/core_bundle_discovery/`, plus the
   four real `templates/*.tex`) against Tectonic's real network bundle, logging every
   file it resolves along the way (a small `LoggingBundle` decorator), then copies that
   observed closure into `bundles/core/` and writes a `SHA256SUM`.

   This also forces one from-scratch LaTeX format build first, against a throwaway
   format cache — Tectonic keys its format cache by bundle digest, and `bundles/core/`'s
   digest will never match a network bundle's, so the very first real compile against
   the curated bundle anywhere has to build the format from scratch. A normal compile
   never touches that path (it just reuses an already-built format), so without forcing
   it here, those files would never get discovered/captured.

**The fixtures are the actual source of truth for what's in the bundle** — the
manifest states intent, but if nothing exercises a listed package's code path, its
files silently don't end up in `bundles/core/`. This has already bitten twice in
practice: the default article class's bold/italic faces and the kernel's `??`
fallback glyphs (only triggered by an unresolved `\ref`/`\cite`, extremely common in a
mid-draft document but not requested by a "clean" fixture), and classic
`\bibliographystyle{plain}` vs. natbib's `plainnat` (a separate `.bst` file). Adding a
package to the manifest means adding or extending a fixture that actually invokes it,
then re-running the build and `cargo test -p quire-core --test core_bundle`.

`DirBundle` (the format `bundles/core/` uses) is flat — no subdirectories, every file
at a unique basename. `build_core_bundle` panics on a basename collision between two
different packages rather than silently letting one overwrite the other.

## The package manager (`prefetchPackages`, `installPackage`, `removePackage`)

`prefetchPackages` scans every `\usepackage`/`\RequirePackage`/`\documentclass` across
the project (via `ProjectIndex`), diffs the resulting candidate files against bundle +
cache (checked with the network tier forced cache-only, so the diff itself never
fetches), then fetches whatever's missing in parallel — one thread per file
(`std::thread::scope`). This runs automatically right after a project opens (so the
first compile doesn't stall mid-flight on a serial fetch) and again on demand from the
missing-packages UI's Install button.

`installPackage`/`removePackage` back the Packages panel directly — install-by-name and
remove-an-on-demand-package, against an isolated on-disk cache separate from
`bundles/core/` itself (removing a package never touches the curated bundle).
