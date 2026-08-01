# Testing

```
cargo test --workspace         # quire-core + quire-sidecar
pnpm --filter @quire/ui test   # packages/ui (Vitest)
```

## Rust: unit tests vs. real-compile integration tests

Most `crates/quire-core/src/*.rs` modules carry `#[cfg(test)] mod tests` covering pure
logic (root detection, file-graph resolution, diagnostics regex rules, page hashing) —
fast, no LaTeX engine involved.

`crates/quire-core/tests/*.rs` are integration tests that run a **real Tectonic
compile** end to end against real fixture projects
(`crates/quire-core/tests/fixtures/`), asserting on the actual PDF bytes, diagnostics,
or shadow-dir contents produced. These are slower (`core_bundle.rs` and `templates.rs`
each take 15-20s) but catch what unit tests structurally can't: whether the compile
pipeline, the bundle, and a real fixture project actually agree with each other.
`network_disabled.rs` specifically cuts network access (pointing `HTTPS_PROXY` at a
closed local port) to prove the offline-bundle guarantee for real, not just by
inspecting code.

A recurring pattern worth knowing: several of these tests use `fresh_project_copy` to
copy a fixture into a temp directory before running (so a test compile's shadow-dir
writes never touch the checked-in fixture itself), and clean up with
`fs::remove_dir_all` at the end.

## Fixture conventions

- `crates/quire-core/tests/fixtures/<name>/` — one folder per test scenario, usually a
  minimal `main.tex` plus whatever it needs (a `refs.bib`, a `chapters/` subfolder, a
  stray unreferenced file to prove it's correctly ignored).
- Fixtures are deliberately **minimal**, not exhaustive — `bundles/core/`'s own
  discovery fixtures (`examples/fixtures/core_bundle_discovery/`) are the deliberately
  kitchen-sink exception, since their whole job is exercising as many packages as
  possible. See [Packages & bundles](packages-and-bundles.md).
- A new fixture that reveals a real file the compile graph should include (e.g. adding
  a `.bib` reference to an existing fixture) can shift other tests' expected file
  counts — `reindex_bench.rs`'s hardcoded "51 files" assertion had to become "52" the
  moment its own fixture's existing (but previously invisible) `refs.bib` started being
  counted, once bib-file resolution was fixed. Worth checking for this kind of ripple
  effect whenever a fixture directory changes shape.

## TypeScript: Vitest, no DOM by default

`packages/ui`'s Vitest config defaults to a `node` environment, not `jsdom` — most
tests target pure, exported functions (`formatLatex`, `mathHighlightSpans`,
`activeParagraphRange`, `buildFileTree`, ...) that don't need a real DOM, constructing
just enough CodeMirror state (`EditorState.create({ doc, extensions })`) to exercise
real parsing/highlighting logic without a full `EditorView`. Testing something that
genuinely needs a live `EditorView` (a real DOM) is the one gap this leaves — none of
the current test suite does, by design, not because it's been tried and skipped.

## What's *not* covered, on purpose

Manual verification (a real run of `pnpm dev`) is still how UI-level correctness gets
checked — layout, real user interaction, visual appearance. `M4_TASKS.md`'s Done notes
are explicit about this split task by task: automated tests prove the logic; a manual
pass in the running app is what's trusted for "does this actually look and feel
right."
