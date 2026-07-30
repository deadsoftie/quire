# `ctan-commands.json` / `symbols.json`

Two bundled completion databases, both embedded into `quire-core` at compile time via
`include_str!` (`src/index/ctan.rs`, `src/index/symbols.rs`) — there's no runtime file
to locate or ship separately; the data lives inside the compiled binary.

## `ctan-commands.json`

A hand-curated set of CTAN package commands, keyed by package name.

**To add a package:** add a new top-level key (the package name, exactly as written
in `\usepackage{...}`) with an array of `{ "name", "arity", "detail" }` entries.
`name` excludes the leading backslash (matches `MacroDef.name`'s convention).
`arity` is the number of required `{}` arguments `insert_with_tabstops`
(`src/rpc/handlers.rs`) turns into tabstops — use `0`, not a guess, for any command
whose real syntax isn't a fixed run of brace arguments (e.g. TikZ's `\draw` takes
`[options] path;`, not `{arg1}{arg2}`). `detail` is optional, one short phrase.

Command names and `detail` strings should be written fresh, not copied verbatim from
a package's own documentation.

## `symbols.json`

A hand-curated set of core LaTeX/amsmath math symbols (Greek letters, common
operators, relations, set/logic notation, arrows, calculus notation). Each entry is
`{ "name", "detail" }`: `name` excludes the leading backslash; `detail` is a short,
plain category/description (e.g. `"Greek letter"`, `"Relation: less than or equal"`).

Unlike `ctan-commands.json`, this database is never scoped by `\usepackage` —
`src/index/symbols.rs` hands the whole list to every bare-command completion request.

KaTeX renders the actual preview client-side (`packages/ui`) from
`CompletionItem.symbolPreview` — this file only supplies which symbols exist and what
to call them, not how they're drawn.
