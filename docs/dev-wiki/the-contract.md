# The contract

The RPC contract — every request/response/event type that crosses the Rust ↔
TypeScript boundary — is written exactly once, in Rust, and generated into TypeScript.
Full detail lives in `docs/CONTRACT.md`; this page is the short version plus the
mechanics of actually changing it.

## Where it lives

```
crates/quire-core/src/rpc/mod.rs   <- source of truth, hand-written Rust
packages/client/src/contract.ts    <- generated output, NEVER hand-edited
packages/client/src/CoreApi.ts     <- hand-written method-signature interface
```

`rpc/mod.rs` types are annotated `#[derive(TS)] #[ts(export, export_to = CONTRACT_TS)]`
(the `ts-rs` crate). Running `cargo test -p quire-core` has the side effect of
regenerating `contract.ts` from those annotations — every type sharing the same
`export_to` path merges into one file. `contract.ts` says so at the top of the file
too: generated output, don't hand-edit it.

`CoreApi.ts` is the one piece that has to be hand-written — `quire-sidecar`'s dispatch
is a string-keyed `match req.method.as_str() { "openProject" => ..., ... }`, not a Rust
trait Rust could derive a TS interface from. Its method signatures intentionally don't
all take a single request object the way the wire protocol does underneath (e.g.
`setRoot(projectId, uri)`, not `setRoot(r: SetRootRequest)`) — match `docs/CONTRACT.md`
exactly if you change one.

## Frozen since the end of M1

Don't change it without raising it explicitly first. If a change is genuinely needed:

1. Change the type(s) in `crates/quire-core/src/rpc/mod.rs`.
2. Re-run `cargo test -p quire-core` to regenerate `contract.ts`.
3. Update `CoreApi.ts` if a method signature changed.
4. Update every handler and transport implementation the change touches.
5. Update `QUIRE_SPEC.md` §6 — it's the spec of record; the generated code and
   `docs/CONTRACT.md` both derive from it, not the other way around.

### A real example

`FileNodeKind` gained a `Bib` variant so `.bib` files could be visible
in `OpenProjectResponse.files` (previously only mirrored into the shadow dir for
compiling, invisible everywhere else). That change touched the enum in `rpc/mod.rs`,
the mapping in `handlers::open_project`, the regenerated `contract.ts`, and
`FileTreePanel.tsx`'s rendering — five steps for what reads like a one-line enum
addition, which is exactly the point of the checklist above.

## Extensions since the freeze

A handful of additions have landed since the v1 freeze without breaking anything
existing — `CompileRequest.engine`, `detectSystemTex()`, and others. `docs/CONTRACT.md`
keeps the authoritative running list ("Extensions since the v1 freeze"); this page
won't duplicate it, since that list changes independently of everything else here.
