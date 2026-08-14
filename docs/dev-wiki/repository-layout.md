# Repository layout

```
crates/quire-core/     Rust library: all real logic, no I/O assumptions
crates/quire-sidecar/  Thin JSON-RPC binary wrapping quire-core, one process per call
packages/client/       TypeScript: the generated contract + typed RPC client (StdioTransport)
packages/ui/           React app: editor, preview, panels, command palette
packages/design/       Shared CSS design tokens + a hand-mirrored JS copy of them
apps/desktop/          Electron shell: main process, menus, native dialogs, IPC
templates/             The four starter documents (article/ieee/acm/beamer)
bundles/                Curated offline LaTeX package bundle + its generator
sample-project/        A real multi-file project, useful for manual testing
docs/CONTRACT.md       The RPC contract, narrated
```

## Why the crate split

`quire-core` is a **library**, deliberately not a binary - "no I/O assumptions" isn't
just a description, it's enforced by the fact that nothing in it spawns a process,
opens a socket, or owns a `main()`. That's what let `quire-sidecar` become a thin
~100-line wrapper: every RPC method is `handlers::method_name(&request) ->
Result<Response, CompileError>`, a plain function call, not something `quire-sidecar`
has any real logic in.

The split also matters for the future: the locked decision requiring an eventual iPad
build (Capacitor) can't spawn subprocesses. A pure library with no process model
baked in is what makes that plausible later without a rewrite - see the System TeX
engine in [Compile pipeline](compile-pipeline.md) for the one place that constraint
already shows up today.

## Why `packages/client` is separate from `packages/ui`

`StdioTransport` (in `packages/client`) spawns Node child processes - it needs real
Node APIs (`child_process`, `readline`). `packages/ui` runs in a sandboxed,
context-isolated Electron renderer with no Node access at all. They can't be the same
package. `packages/client` is consumed two ways:

- **`apps/desktop`**'s main process constructs a real `StdioTransport` and exposes it to
  the renderer over `contextBridge` (see `apps/desktop/src/preload.js`).
- **`packages/ui`** never imports `StdioTransport` directly - it only imports the
  *types* (`contract.ts`, `CoreApi.ts`) for typing `window.quire`. See
  [The desktop shell](desktop-shell.md).

## Why `packages/design` exists as its own package

Both `packages/ui` and (eventually) any other frontend need the same color/spacing/type
tokens. `tokens.css` is the real source; `index.ts` is a **hand-maintained JS mirror**
of the same values (its own comment says so) for anything that needs them as JS values
rather than CSS custom properties - keeping these in sync is a manual discipline, not
generated, so a token change means updating both. See
[Design system](design-system.md).
