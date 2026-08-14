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
