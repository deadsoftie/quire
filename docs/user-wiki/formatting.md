# Formatting

Quire can reformat a document's indentation and spacing - not a full pretty-printer,
but enough to keep a document's structure readable without manual upkeep.

## What it does

- **Indents by nesting.** Content inside an environment is indented one level deeper
  than its own `\begin{...}`/`\end{...}` lines.
- **Collapses blank-line runs.** Three or more blank lines in a row become exactly one
  (a single blank line - a paragraph break - is left alone).
- **Strips trailing whitespace** from every line.

## What it deliberately doesn't do

- **No prose reflow.** Your own line breaks within a paragraph are never touched -
  Quire only changes each line's *leading* indentation, not where it wraps. Reflowing
  text risks corrupting math-mode-sensitive line breaks, so it's left entirely alone.
- **Verbatim content is untouched.** Anything inside a `verbatim`/`lstlisting`/`minted`
  environment is passed through byte-for-byte, even if it looks like it "should" be
  reindented - that content is code or literal text, not something safe to reformat.

## Running it

- **Format Document** (⇧⌥F, Edit menu, or the command palette) reformats the current
  file on demand.
- **Format-on-save** - every Save also reformats first, so a document's indentation
  never drifts out of sync just from normal editing. If formatting wouldn't actually
  change anything, saving doesn't dirty the file for no reason.
