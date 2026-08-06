# The desktop shell (`apps/desktop`)

## Process model

`apps/desktop/src/main.js` is the Electron main process. It:

- constructs one `StdioTransport` (`packages/client`) for the app's lifetime, which
  itself spawns a fresh `quire-sidecar` process **per RPC call** — see
  [The contract](the-contract.md) and [Repository layout](repository-layout.md) for why
  `quire-core` is a library, not a server;
- owns every native dialog (`dialog.showOpenDialog`/`showSaveDialog`/`showMessageBox`)
  and the application menu;
- persists session state to a JSON file under `app.getPath("userData")`;
- sets the dev-mode window/taskbar icon (`BrowserWindow`'s `icon` option) and, on
  macOS, the Dock icon (`app.dock.setIcon`, since the `icon` option alone doesn't drive
  the Dock outside a packaged `.app`) from `apps/desktop/assets/icon.png`. No packager
  (electron-builder/forge) is configured yet, so this doesn't yet cover a built app's
  `.icns`/`.ico`.

The renderer (`packages/ui`, loaded from the Vite dev server or a built bundle) runs
sandboxed and context-isolated — no direct Node or filesystem access. Everything it
needs crosses through `preload.js`'s `contextBridge`.

## The IPC surface (`preload.js`)

Two globals, both thin `ipcRenderer.invoke(channel, ...args)` wrappers:

- **`window.quire`** — mirrors `CoreApi` exactly (`core:openProject`, `core:compile`,
  ...), typed against `packages/client`'s `CoreApi` directly in `quire.d.ts` (the
  renderer can't import `StdioTransport` itself — it spawns Node child processes).
- **`window.quireDesktop`** — everything that isn't part of the core contract and never
  will be: native dialogs (`chooseProjectFolder`, `chooseNewProjectFolder`, `createFile`,
  `chooseFile`, `confirmDiscard`), scaffolding (`scaffoldProject`, `exportProject`),
  session (`loadSession`/`saveSession`), and `onMenuCommand` (see below). Documented
  inline in `packages/ui/src/quire.d.ts`.

## Menu → command dispatch

Every non-role menu item calls one function, `sendMenuCommand(id)`, which sends the
command's id (a string, e.g. `"file.export"`) over `menu:command` IPC. The renderer's
`menuBridge.ts` is the only place that turns an id back into a real `.run()` call,
looked up from the same command registry the palette lists from — see "The command
system" in [Editor internals](editor-internals.md). This is
why every accelerator in `main.js` has a matching `// No keybinding` comment at its
`useCommand` call site: registering the same key twice (once as a native accelerator,
once as an in-app keydown handler) would double-fire.

Checkbox items (View menu toggles) don't reactively bind to renderer state on their
own — `updateViewMenuChecks(state)` is called from `desktop:reportViewState`, which
`App.tsx`'s own effect calls whenever any of that state changes, keeping the menu's
checkmarks in sync by hand rather than by binding. The View menu's **Theme** submenu is
the one non-boolean case: it's a `type: "radio"` group (one item per built-in theme, ids
`view.theme.<id>`, dispatching `theme.select.<id>`) synced against `state.themeId`
rather than a boolean key in `VIEW_MENU_CHECK_IDS`. Custom (user-created) themes aren't
listed there — Electron's menu is built once at launch — so a custom theme active leaves
the whole radio group unchecked; the command palette is the only surface that lists
custom themes. Built-in theme ids/names are duplicated in `main.js` from
`packages/design/src/themes.ts`'s `builtinThemes` for the same reason as everything else
in this section: no shared TS import can cross the CJS main-process boundary.

## Native dialogs worth knowing the shape of

- **`chooseNewProjectFolder`** uses `showOpenDialog({properties: ["openDirectory",
  "createDirectory"]})` — one dialog that lets the user either pick an existing empty
  folder or create-and-name a new one inline (macOS shows its own "New Folder" button;
  Windows/Linux directory pickers already have their own), rather than a bespoke
  two-step pick-parent-then-type-a-name flow.
- **`scaffoldProject(dirPath, templateId)`** validates `templateId` against a fixed
  allowlist before ever building a file path with it — renderer-supplied IPC input,
  unlike a project's own already-validated file paths, so this is the one place a
  compromised renderer could otherwise smuggle a `../../etc/passwd`-style path through.
  Its "is this folder empty" check ignores dotfiles, since a freshly created Finder
  folder already has a `.DS_Store`.
- **`exportProject`** builds a `.zip` (when bundling source) using `archiver` —
  installed at `^8.0.0`, which turned out to be an **ESM-only rewrite** with a
  `ZipArchive` class, not the classic CJS `archiver(format, opts)` factory function
  older versions/documentation describe. `main.js` is CJS, so this needs a dynamic
  `import("archiver")` inside the (already-async) export handler rather than a
  top-level `require`. Worth knowing before assuming any online archiver example code
  applies as-is.

## Session persistence

`SessionState` (`packages/ui/src/session.ts`) round-trips through
`window.quireDesktop.loadSession`/`saveSession` to a JSON file, debounced
(`SAVE_SESSION_DEBOUNCE_MS`) rather than written on every change. `normalizeSession`
validates the loaded JSON field-by-field against a `fallback`, so a corrupted or
partially-missing session file degrades gracefully to defaults per-field rather than
being rejected wholesale. `projectPath: null` means no project is open (the empty/
Welcome state) — restoring a session with a `projectPath` that no longer resolves
(moved/deleted) also degrades to that same empty state, not an error.
