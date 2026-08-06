# The editor

The editor is a full LaTeX-aware code editor (built on CodeMirror 6 with a real LaTeX
grammar, not a generic text box), the source-of-truth pane on the left half of the
window by default.

## Syntax highlighting

Comments, macros, section commands (`\section`, `\chapter`, ...), reference commands
(`\ref`, `\cite`, `\label`, ...), `\begin`/`\end` keywords, environment names, math
delimiters, and verbatim/code-listing bodies are all colored distinctly. Math regions
(`$...$`, `$$...$$`, `\[...\]`, `\(...\)`, and math environments like `align`) also get
a subtle background tint, so math jumps out at a glance.

## Autocomplete

Type and Quire offers completions as you go, categorized by context:

- **Commands** — right after a `\`, offers built-in LaTeX commands, plus your own
  `\newcommand`/`\DeclareMathOperator`/`\def` macros (ranked above everything else,
  since they're specific to your document), plus commands unlocked by packages you've
  actually `\usepackage`'d (e.g. `\usepackage{tikz}` unlocks TikZ-specific commands).
- **Environments** — after `\begin{`.
- **Labels** — inside `\ref{`/`\eqref{`/`\pageref{`/etc., every `\label{...}` defined
  anywhere in the project (not just the current file).
- **Citations** — inside `\cite{`/`\citep{`/`\citet{`, every entry in whichever `.bib`
  file your `\bibliography{}`/`\addbibresource{}` points at.
- **Paths** — inside `\input{`/`\include{`, `.tex` files not already referenced
  elsewhere in the project; inside `\includegraphics{`, image files only.
- **Math symbols** — in math mode, symbol names like `\alpha` show a live KaTeX preview
  of what the symbol actually renders as.

## Inline snippets

A short trigger word, expanded via Tab, with tab-stops to fill in:

| Trigger | Expands to |
|---|---|
| `fig` | a `figure` environment (image path, caption, label) |
| `tab` | a `table` environment (caption, label, tabular) |
| `eq` | an `equation` environment with a label |
| `itm` | an `itemize` environment |
| `sec` | `\section{}` |
| `beg` | a matching `\begin{...}`/`\end{...}` pair |

Snippets only trigger on a bare word (not right after a `\`, so typing `\sec` still
offers the `\section` *command*, not the `sec` snippet).

## Snippets panel

A much larger, browsable catalog lives in the **Snippets** side panel (see
[Navigation](navigation.md)) — dozens of ready-made blocks (front matter, math
environments, figures/tables, lists, references, code listings, layout tricks, Beamer
slides) grouped by category, searchable by name/description/tag. Two ways to use a
card:

- **Drag it** into the editor at the exact spot you want it.
- Click **Insert** to drop it at your cursor.

Either way, if the block needs a package your document doesn't have loaded yet (e.g. the
TikZ canvas needs `tikz`, a theorem block needs `amsthm`, a Beamer slide needs the
`beamer` document class), Quire adds the missing `\usepackage{...}` line — or, for
Beamer slides, switches your `\documentclass` — right before inserting the snippet, so
it compiles as-is instead of erroring on a missing package. A card's "requires X" note
tells you up front which ones do this.

## Environment name sync

Rename the environment name in `\begin{itemize}` and the matching `\end{itemize}`
updates automatically to match, and vice versa — you never have to fix both ends
yourself.

## Pasting images

Paste an image (a screenshot, a copied file) directly into the editor and Quire writes
it into `<project>/figures/` and inserts an `\includegraphics{...}` referencing it —
`.jpg`/`.jpeg` sources keep their extension, everything else (including a macOS
screenshot) is saved as `.png`.

## Format Document

See [Formatting](formatting.md).
