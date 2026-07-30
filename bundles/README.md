# `bundles/core/`

A curated, offline LaTeX package bundle: a flat directory of every `.sty`/`.cls`/`.def`/
`.fd`/font/`.bst` file needed to compile the document classes and packages listed in
`manifest.json`, plus a `SHA256SUM` digest file.

`bundles/core/` itself is generated, not hand-written — don't edit files in it directly.

## Resolution: bundle → cache → network

`crate::bundle::resolve_bundle()` (`crates/quire-core/src/bundle.rs`) is one real
fallback chain, not three separate paths every caller has to know to try in order:

1. **Bundle** — `bundles/core/`, when it's been built. Always available, zero network,
   ever.
2. **Cache** — anything ever fetched before, on local disk permanently (Tectonic's own
   `BundleCache`, keyed by content digest).
3. **Network** — Tectonic's own network-fetching default bundle, for whatever isn't in
   either of the above.

Tiers 2 and 3 are actually one object (`config.default_bundle(false)`) — Tectonic's own
network bundle already checks its local disk cache before ever touching the network, and
only fetches on a genuine cache miss. `resolve_bundle()`'s own job is just chaining tier 1
in front of it (`TieredBundle` in `bundle.rs`), for the specific files core doesn't carry
(`tikz`, anything a project pulls in beyond the curated set).

That fallback bundle is constructed **lazily** — only the first time core actually misses
a name, never up front. A document core fully covers must never require network access,
or even a pre-existing cache, to compile — constructing tier 2/3 eagerly would mean every
compile depends on *something* (network or a prior cache) existing, even when core alone
would have been enough. `crates/quire-core/tests/network_disabled.rs` proves this by
literally cutting network access (pointing `HTTPS_PROXY` at a closed local port — verified
empirically to make a real fetch fail fast rather than silently succeed) and confirming a
core-covered file still resolves, and a cached-but-not-in-core file (`tikz.sty`) resolves
too once warm.

## Two-stage pipeline

1. **`manifest.json`** — hand-curated, human-traceable list of document classes,
   packages, BibTeX styles, babel languages, and font families that should be in core,
   plus an `excluded` section documenting what was deliberately left out and why
   (currently: `biblatex`/`biber`, broken independent of any bundling decision, and
   `tikz`/`pgf`, a debatable size/frequency tradeoff).

   A package *name* isn't a file — `\usepackage{amsmath}` alone pulls in many
   transitive `.sty`/`.def`/`.fd`/font files, and Tectonic has no bundle-*building* API,
   only bundle-*reading*. So the manifest is necessarily step one of two: it still needs
   expansion into an exact file closure before anything can be assembled.

2. **`crates/quire-core/examples/build_core_bundle.rs`** — compiles the fixtures in
   `crates/quire-core/examples/fixtures/core_bundle_discovery/` against Tectonic's real
   default bundle while logging every filename it actually resolves (a small
   `LoggingBundle` decorator wrapping the real bundle), then copies that observed file
   closure into `bundles/core/` and writes `SHA256SUM`.

   It also forces one from-scratch LaTeX format build against a throwaway format cache
   directory before compiling the fixtures. Tectonic keys its format cache by bundle
   digest, and `bundles/core/`'s own digest will never match a network bundle's, so the
   very first compile against the curated bundle on any machine has to build the format
   from scratch — which reads `tectonic-format-latex.tex` and everything it in turn
   `\input`s. A normal compile never touches those files (it just reuses an
   already-built format), so they'd otherwise never get discovered.

   Run it with:

   ```
   cargo run -p quire-core --example build_core_bundle
   ```

## Fixtures are the actual source of truth for what's in the bundle

`manifest.json` states intent; the fixtures in `core_bundle_discovery/` are what
actually gets exercised and therefore captured. If a class/package/style is in the
manifest but no fixture exercises the code path that touches its files, it silently
won't end up in `bundles/core/`. Concretely, this has already bitten:

- The default article class's bold/italic Latin Modern faces, and the kernel's
  bold `??` fallback glyphs for an unresolved `\ref`/`\cite` — not requested by any
  document that only cites labels it actually defines, but extremely common in an
  editor where documents are mid-draft most of the time. Covered by
  `bare_article.tex`.
- Classic `\bibliographystyle{plain}` (vs. natbib's own `plainnat`) — a completely
  separate `.bst` file. Covered by `bibtex_plain.tex`.

When adding a package/class/style to the manifest, add or extend a fixture that
actually invokes it, then re-run the build and `cargo test -p quire-core --test
core_bundle` (which compiles every fixture straight against `bundles/core/`, with no
network fallback available, catching exactly this class of gap).

The fixtures are hand-written stand-ins for the app's real starter templates. Re-run
discovery once real templates exist, so the bundle reflects what's actually shipped
rather than an approximation of it.

## Flat directory, so basename collisions are real

`DirBundle` (the bundle format `bundles/core/` uses) has no subdirectories or search
path — every file sits directly in the root with a unique basename. `build_core_bundle`
panics if two discovered files would collide on basename; if that happens, it means two
different packages ship a same-named file and one of them needs to be dropped from the
manifest or handled specially, not silently overwritten.
