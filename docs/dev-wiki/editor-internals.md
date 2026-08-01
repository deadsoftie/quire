# Editor internals (`packages/ui`)

The editor is CodeMirror 6 with a real, custom LaTeX grammar — not a generic text area
with regex-based coloring.

## The LaTeX grammar (`packages/ui/src/latex/`)

`latex.grammar` is a Lezer LR grammar, compiled via `pnpm generate`
(`scripts/generate-latex-parser.mjs`) into `parser.ts`/`parser.terms.ts` — **committed,
generated output, never hand-edited**, same discipline as `contract.ts`. Editing LaTeX
support means editing `latex.grammar` and regenerating, always reviewing the diff
before trusting it.

Distinguishes real node types most naive LaTeX tokenizers don't bother with:
`SectionCommand`/`RefCommand` are `@specialize<Command, "\\section" | ...>` productions
— separate node types from a bare `Command`, not just separately-colored via a keyword
list — plus real math-delimiter nodes (`InlineMath`, `DisplayMathDollar`,
`DisplayMathBracket`, `InlineMathParen`, `MathEnvironment`) and environment/verbatim
distinctions (`EnvName`, `MathEnvName`, `VerbatimEnvName`, `VerbatimBody`).

`language.ts` defines `latexLanguage` (the `LRLanguage` + `styleTags` mapping node
types to highlight tags) and `latex()` (bundles it with `syntaxHighlighting()`).
`MATH_DELIMITED_NODE_NAMES` is exported from here specifically so `editorModes.ts`'s
math-region background tint can reuse the same node-name list rather than duplicating
it.

## The formatter (`latex/formatter.ts`)

`formatLatex(source: string): string` — a pure function, line-based rather than a full
tree re-serialization. It parses once with `latexLanguage.parser`, walks the tree
collecting environment spans (for indentation depth) and `VerbatimBody` line ranges
(passed through byte-for-byte, untouched), then does a single line-based pass computing
indentation via a delta/prefix-sum sweep (each environment span only ever adjusts a
running depth counter at its own two boundary lines — O(lines + environments), not
O(lines × environments)).

Being line-based rather than a real re-serialization is what keeps prose reflow out of
scope for free: every line's own content is left exactly as written, only its leading
indentation and blank-line context change — there's no line-width-fitting decision to
make, since paragraph-internal line breaks are never touched.

## Environment name sync (`environmentSync.ts`)

A CM6 transaction filter: on every edit, checks whether the change fell entirely inside
an `EnvName`/`MathEnvName`/`VerbatimEnvName` node, finds that node's sibling in the
`\begin`/`\end` pair (compared by tree position, since Lezer hands out fresh
`SyntaxNode` wrapper objects per call — reference equality never reliably holds even
for "the same" position), and mirrors the edit into it via a second `ChangeSpec` in the
same transaction.

## The command system (`commands/CommandContext.tsx`)

One registry (`useCommand(command)`) that every command in the app — menu items,
editing-mode toggles, panel switches — registers into. `usePaletteCommands()` is what
the command palette lists from; `apps/desktop`'s native menu never runs its own logic,
it sends a command **id** over IPC (`menuBridge.ts` looks it up in the same registry
and calls `.run()`) — a menu click, its keyboard accelerator, and typing the command's
name into ⌘K all end up running the exact same function. See
[The desktop shell](desktop-shell.md) for the IPC side of that.

`shortcut` on a `Command` is **display-only** (what the palette shows) — the *real*
keybinding, when one exists, is always the native Electron menu accelerator, never a
second in-app keydown handler. Every command with a shortcut in this app has a comment
to that effect; registering both would double-fire on the same keypress.

## Editor modes as compartments (`editorModes.ts`)

Focus mode, Typewriter scrolling, Serif prose mode, and Word wrap are each a CM6
`Compartment`, shared across `Editor` instances — toggling one dispatches a
`compartment.reconfigure(...)` effect rather than tearing down and rebuilding the whole
extension list. Focus mode's dimming and the math-region background tint both follow
the same `ViewPlugin` + `Decoration`/`DecorationSet` shape, rebuilt only on the state
changes that could actually affect them (`docChanged`/`selectionSet` for focus mode;
`docChanged`/`viewportChanged` — and bounded to `view.visibleRanges`, not the whole
document — for the math tint, since it doesn't depend on cursor position at all).

## Autocomplete and snippets

`makeCompletionSource` (in `Editor.tsx`) wraps the RPC `complete()` call as a CM6
completion source; `snippets.ts`'s `snippetCompletionSource` is a second, independent
completion source for the fixed snippet list (`fig`, `tab`, `eq`, `itm`, `sec`, `beg`),
both registered together via `autocompletion({ override: [...] })`. Snippets reject
right after a bare `\` specifically so typing `\sec` still offers the `\section`
*command* completion, not the `sec` snippet.
