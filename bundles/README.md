# `bundles/core/`

A curated, offline LaTeX package bundle: a flat directory of every `.sty`/`.cls`/`.def`/
`.fd`/font/`.bst` file needed to compile the document classes and packages listed in
`manifest.json`, plus a `SHA256SUM` digest file. `crate::bundle::resolve_bundle()`
(`crates/quire-core/src/bundle.rs`) prefers this bundle when it's present, so a compile
never touches the network — falling back to Tectonic's own network-fetching default
bundle only when `bundles/core/` hasn't been built yet.

`bundles/core/` itself is generated, not hand-written — don't edit files in it directly.

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
