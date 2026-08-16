# Building & running

The full, current instructions (prerequisites, clone, build, run, test) live in the
root [`README.md`](../../README.md) - this page won't fork them, since a build-steps
duplicate is exactly the kind of thing that quietly goes stale. Read that first.

## The one thing worth flagging here

`cargo build --workspace` has to run (and be re-run after *any* Rust change) before
`pnpm dev` will work - the desktop app spawns the sidecar binary directly from
`target/debug/quire-sidecar` (see `packages/client/src/sidecarProcess.ts`'s
`SIDECAR_PATH`), it doesn't build it itself. A stale or missing sidecar binary is the
most likely reason `pnpm dev` runs but every RPC call fails.

The offline core bundle (`cargo run -p quire-core --example build_core_bundle`) is
optional for development - without it, compiling still works, just via Tectonic's
network-fetching bundle instead of fully offline. See
[Packages & bundles](packages-and-bundles.md) for what that command actually does and
when it needs re-running.

## Versioning

The app version is a single source of truth, not something to hand-edit in seven
places. Root `package.json`'s `"version"` field is canonical:

- Rust: `Cargo.toml`'s `[workspace.package] version` is the canonical value for the
  Rust side; `crates/quire-core` and `crates/quire-sidecar` inherit it via
  `version.workspace = true`, so they can never drift on their own.
- Everything else (`apps/desktop`, `packages/ui`, `packages/design`,
  `packages/client`'s `package.json`, plus that one `Cargo.toml` line) is kept in sync
  by `scripts/sync-version.mjs`.

To bump the version: run `pnpm version <bump>` (e.g. `pnpm version 1.2.0` or
`pnpm version patch`) at the repo root - this updates root `package.json` and cascades
to every other file automatically via the `version` lifecycle hook. `pnpm sync-version`
re-runs just the propagation step by hand if the files ever drift. `postinstall` also
runs it as a catch net on `pnpm install`.

`apps/desktop/package.json`'s version is the only one with runtime effect - it's what
Electron's `app.getVersion()` reads, surfaced in the UI via `window.quireDesktop.appVersion`
(see [The desktop shell](desktop-shell.md)) and shown in the status bar footer. The rest
exist for consistency across the workspace, not because anything reads them at runtime.
