# Indexing & completion

`crate::index` (`crates/quire-core/src/index/`) builds a per-project index used for
autocomplete and the Outline panel - labels, citations, macros, packages, document
class, and each file's own section outline.

## `ProjectIndex`

Built from a `FileGraph` (the same one [Compile pipeline](compile-pipeline.md) walks
via `build_file_graph`) - one `FileIndex` per `.tex` file in the graph, merged:

- **Outline** - per-file, not merged (each file's `outline()` RPC call returns just its
  own sections).
- **Labels** (`\label{...}`) - merged across every file, so `\ref{...}` completion in
  one chapter can offer a label defined in another.
- **Citations** - `find_bib_resources` independently re-parses `\bibliography`/
  `\addbibresource` from source text (see the note on duplication below), resolves the
  `.bib` file(s), and parses BibTeX entries directly (`parse_bib`) for author/title/year
  completion detail.
- **Macros** - `\newcommand`/`\DeclareMathOperator`/`\def`, merged across files, with
  arity parsed from the definition (drives the `${1:...}` tabstops a completion
  inserts).
- **Packages** / **document class** - scanned per file, used to gate package-specific
  completions (see below).

## Completion ranking (`rpc/handlers.rs::complete`)

Context is detected first - `is_ref_completion_context`, `is_cite_completion_context`,
`is_command_completion_context`, `is_input_completion_context`,
`is_includegraphics_completion_context` - each a small parser looking at the text
immediately before the cursor, not a full reparse. Exactly one of these (or none) is
true for a given cursor position.

Within "command" completions specifically, three tiers, deliberately ordered
(`PACKAGE_PRIORITY > PROJECT_LOCAL_PRIORITY` would be a bug - there's a test asserting
the opposite):

1. **Project-local** - your own macros. Ranks first: specific to *this* document, most
   likely to be what you meant.
2. **Package commands** - unlocked by whatever's actually `\usepackage`'d in the
   project, sourced from `data/ctan-commands.json` via `index::ctan`.
3. **Global fallback** - built-in LaTeX commands and math symbols
   (`data/symbols.json` via `index::symbols`), always available regardless of what's
   loaded.

## Two independent bib-file scanners, on purpose

`index::find_bib_resources` and `project::parse_references`'s bibliography handling
both parse `\bibliography`/`\addbibresource` from source text - independently, not
sharing one implementation. This isn't an oversight: they serve different purposes
(citation-completion detail vs. file-graph/shadow-dir mirroring) and the codebase's own
established pattern is for each module to own its text scanning tailored to its need,
while sharing only genuinely low-level utilities (`project::strip_comments`, reused by
`index` rather than reimplemented). See [Compile pipeline](compile-pipeline.md) for the
file-graph side of bib handling.

## Static data (`crates/quire-core/data/`)

`ctan-commands.json` and `symbols.json` are build-time assets, embedded via
`include_str!` - a parse failure is a bug in the file itself, not a runtime condition
to handle gracefully (both loaders `.expect()` rather than propagate an error).
