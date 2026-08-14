# Quire

A local-first LaTeX editor: a Rust compile/index core (`quire-core`, exposed to the
desktop shell over JSON-RPC via `quire-sidecar`) driving an Electron + React frontend
(`apps/desktop`, `packages/ui`).

## Repository layout

```
apps/desktop/     Electron shell (main process, menus, native dialogs)
packages/ui/      React editor UI (CodeMirror 6, PDF preview, command palette)
packages/client/  Sidecar transport + typed RPC client, shared by ui and desktop
packages/design/  Shared design tokens / primitives
crates/quire-core/    Compile pipeline, project indexing, diagnostics, RPC handlers
crates/quire-sidecar/ Thin JSON-RPC process wrapping quire-core for the desktop shell
bundles/          LaTeX package bundle manifest + generator (see bundles/README.md)
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain, installed via `rustup`)
- [Node.js](https://nodejs.org/) (LTS) and [pnpm](https://pnpm.io/installation)
- A C/C++ toolchain (Xcode Command Line Tools on macOS, `build-essential` on Linux) -
  the Rust core depends on [Tectonic](https://github.com/tectonic-typesetting/tectonic),
  which builds several vendored C/C++ libraries from source. If `cargo build` fails on
  a missing system library, check Tectonic's own
  [build documentation](https://tectonic-typesetting.github.io/en-US/install.html) for
  your platform.

## Clone

```
git clone https://github.com/deadsoftie/quire.git
cd quire
```

## Build

```
pnpm install
cargo build --workspace
```

`pnpm install` installs JS dependencies for every workspace package (`apps/desktop`,
`packages/ui`, `packages/client`, `packages/design`). `cargo build --workspace` builds
`quire-core` and `quire-sidecar`; the desktop app spawns the sidecar binary directly
from `target/debug/quire-sidecar`, so this has to run (and be re-run after any Rust
change) before `pnpm dev` will work.

The first Rust build compiles Tectonic and its dependencies, which takes a few minutes.

### Core LaTeX bundle (optional, for offline compiling)

By default, compiling falls back to Tectonic's network-fetching bundle. To compile
fully offline against a curated local package set instead:

```
cargo run -p quire-core --example build_core_bundle
```

See `bundles/README.md` for what this does and when to re-run it.

## Run

```
pnpm dev
```

This starts the `packages/ui` Vite dev server and the Electron shell together, waiting
for the dev server before launching the window.

## Test

```
cargo test --workspace
pnpm --filter @quire/ui test
```
