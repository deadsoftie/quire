# Quire developer guide

For what the app does, see [`user-wiki/`](../user-wiki/README.md). This is how it's
built.

## Architecture at a glance

Three tiers, two processes:

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  apps/desktop (Electron)     │  spawn  │  quire-sidecar (Rust binary)      │
│  main process: menus, native │ ──────► │  one process PER RPC CALL --      │
│  dialogs, session, IPC       │  stdio  │  reads one JSON-RPC request off   │
│                               │ ◄────── │  stdin, writes one response,     │
│  packages/ui (React)         │  JSON   │  exits. No server, no daemon.     │
│  renderer: editor, preview,  │         │                                    │
│  panels, command palette     │         │  wraps quire-core::rpc::handlers  │
└─────────────────────────────┘         └──────────────┬─────────────────────┘
                                                          │ calls into
                                                          ▼
                                          ┌──────────────────────────────────┐
                                          │  quire-core (Rust library)        │
                                          │  all real logic, no I/O           │
                                          │  assumptions: project detection,  │
                                          │  the file graph, the compile      │
                                          │  pipeline, indexing/completion,   │
                                          │  diagnostics, the package bundle  │
                                          └──────────────────────────────────┘
```

- **`quire-core`** holds every real behavior and no server-side state at all —
  `ProjectId` *is* the project's root directory path, so every call re-derives whatever
  it needs from that path. See [Compile pipeline](compile-pipeline.md) and
  [Indexing & completion](indexing-and-completion.md).
- **`quire-sidecar`** is a thin JSON-RPC dispatcher over `quire-core`'s handlers —
  line-delimited JSON on stdin/stdout, one request per line. A *new process per call*,
  not a long-lived server: see [The desktop shell](desktop-shell.md).
- **`apps/desktop`** is the Electron shell: native menus/dialogs/session persistence in
  the main process, `packages/ui`'s React app in the renderer.
- **The contract** (`crates/quire-core/src/rpc/mod.rs`, generated into
  `packages/client/src/contract.ts`) is the one thing that crosses the Rust/TypeScript
  boundary. See [The contract](the-contract.md).

## Contents

1. [Repository layout](repository-layout.md)
2. [The contract](the-contract.md)
3. [Compile pipeline](compile-pipeline.md)
4. [Indexing & completion](indexing-and-completion.md)
5. [Packages & bundles](packages-and-bundles.md)
6. [Editor internals](editor-internals.md)
7. [The desktop shell](desktop-shell.md)
8. [Design system](design-system.md)
9. [Testing](testing.md)
10. [Building & running](building-and-running.md)
11. [Project history](project-history.md)

## Source-of-truth policy

This wiki narrates *how the pieces fit together and why* — it doesn't fork anything
that's already exhaustively and authoritatively documented elsewhere. For exact,
current specifics, the real sources of truth are:

- **`docs/CONTRACT.md`** — the RPC contract, type by type, plus every "what's real vs.
  stubbed" and "things worth knowing before building against this" note.
- **`QUIRE_SPEC.md`** — the original design spec: goals, non-goals, phased milestones,
  the design language (§7).
- **`M4_TASKS.md`** — per-task implementation notes for the current milestone, each with
  a "Done" writeup explaining what was actually built and why, once a task lands.

If something here disagrees with one of those, they win — update this wiki, not them.
