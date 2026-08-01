# Compile pipeline

The path from "user edits a file" to "PDF + diagnostics in the UI," end to end.

## 1. Root detection (`project/root.rs`)

`detect_root(project_dir)` finds the document to actually compile:

1. An explicit `% !TEX root = path` marker (TeXShop/TeXWorks convention) wins outright.
2. Exactly one file with a real `\documentclass` (the `subfiles` package's own
   per-chapter `\documentclass` is excluded from this check) wins.
3. Otherwise, whichever candidate has the highest `\input`/`\include`/`\subfile`
   out-degree — deliberately out-degree (what it references), not in-degree (how often
   it's referenced), so a shared preamble file included *by* everything else doesn't
   win the tiebreak.
4. Still tied → `RootConfidence::Ambiguous`, with the tied candidates returned for the
   UI to prompt with.

## 2. The file graph (`project/mod.rs`)

`build_file_graph(root)` walks from the root document, following `\input`/`\include`/
`\subfile` recursively (cycle-safe — a `HashSet` of visited paths), and separately
collects two kinds of *leaf* references that never get recursed into:

- `\includegraphics{...}` → `FileKind::Graphic`
- `\bibliography{...}` (comma-separated, one `Reference` per name) /
  `\addbibresource{...}` → `FileKind::Bib`

Every reference resolves within the project directory only —
`resolve_within`/`resolve_tex`/`resolve_graphic`/`resolve_bib` all reject an absolute or
`..`-laden path, so project source can never smuggle an out-of-project read/write
target past anything downstream. An unresolved reference (a dangling `\input{missing}`)
is a real, valid state — `Reference.resolved: None` — not an error.

This is the same structure `OpenProjectResponse.files` exposes to the UI (minus one
detail — see [The contract](the-contract.md#a-real-example)) and what the Explorer
tree, `compile()`'s shadow-dir mirroring, and the export feature's source bundle all
walk.

## 3. Shadow-dir mirroring (`rpc/handlers.rs::compile`)

Every compile mirrors the *current* state of every file in the graph into
`<project>/.quire/build/` before running anything:

- `.tex` files: the dirty-buffer's in-memory text if the file is open and unsaved
  (`CompileRequest.dirtyBuffers`), otherwise the on-disk content.
- Everything else (graphics, `.bib`): always read fresh from disk (dirty buffers only
  ever apply to open editor tabs, which are always `.tex`).

The user's real files are never touched by a compile — only by an explicit `writeFile`
(Save).

## 4. Running the engine (`rerun.rs`, `system_tex.rs`)

Two engines, same decision logic:

- **Tectonic**, embedded in-process via `tectonic::driver::ProcessingSessionBuilder`.
- **System TeX**, a subprocess (`xelatex`/`pdflatex`) — the one place in this crate that
  spawns a process, gated behind an opt-in Settings toggle, desktop-only (an iPad build
  can't `fork`/`exec` at all).

Both share `run_passes_with_rerun` (`rerun.rs`), which owns the actual "when to rerun"
decision so it isn't duplicated per engine:

1. Run one pass.
2. Diff `.aux` against its pre-pass content. Changed → cross-references need another
   pass.
3. If the `.aux` declares a `\bibdata{...}` and its citation fingerprint
   (`\bibdata`/`\citation` lines) changed since the last run, run BibTeX — invisible to
   the `.aux` diff above, since BibTeX only touches `.bbl`.
4. Rerun while `.aux` keeps changing, capped at 4 passes total.

A pass's own nonzero exit code is never treated as fatal — an ordinary recoverable
LaTeX error doesn't abort a real `nonstopmode` run for either engine. The real verdict,
for both, is whether `texput.pdf` exists once every pass has finished.

## 5. Page-hash diffing (`page_hash.rs`)

Every compile hashes each output page's content stream and diffs against the previous
compile's hashes (cached in the shadow dir), returning only the page numbers that
actually changed. This is what lets the PDF preview redraw only the pages that moved,
not the whole document, on every keystroke-triggered recompile.

## 6. Diagnostics translation (`diagnostics/`)

The engine's raw log text is parsed into structured `Diagnostic`s by a regex-based
translation table (`diagnostics/rules.rs`) covering both fatal `!`-errors and non-fatal
warnings that still appear on a successful compile (undefined references/citations,
overfull boxes, "rerun needed"). `diagnostics/file_tracker.rs` walks the log's
`(filename ...)` push/pop nesting to attribute each diagnostic to the real file `uri`
it came from — the engine only ever sees one fixed input name (`texput.tex`), so this
is what maps that back to the project's actual files.

Noise suppression is real, not just "keep everything and let the UI hide it": overfull
boxes under 5pt never surface at all, and "rerun needed" is only reported from the
*last* pass's log, so it naturally disappears once a later rerun actually resolves it.
A log the translator recognizes nothing in still produces one raw, untranslated
diagnostic rather than silence.

## The bundle underneath all of this

Every pass resolves package files through `crate::bundle::resolve_bundle()` — see
[Packages & bundles](packages-and-bundles.md).
