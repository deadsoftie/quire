# `ctan-commands.json`

Task 3.5's CTAN command database. Embedded into `quire-core` at compile time via
`include_str!` (see `src/index/ctan.rs`) — there's no runtime file to locate or ship
separately; the data lives inside the compiled binary.

## Data pipeline: hand-curated, not scraped

This is a **hand-curated starter set**, not the output of a CTAN-scraping pipeline.
Real CTAN packages document their commands in wildly inconsistent formats (`.dtx`
literate source, PDF manuals, plain `.tex` docs with no fixed structure), and a
scraper robust enough to extract accurate command signatures across even a few dozen
packages is a real, standalone project of its own — out of scope for landing this
task now. Section 9.4's actual quality bar is scoping (*"only suggest what is
actually available"*), not database size, and that bar holds equally well for five
well-chosen packages as for five hundred.

**To add a package:** add a new top-level key (the package name, exactly as written
in `\usepackage{...}`) with an array of `{ "name", "arity", "detail" }` entries.
`name` excludes the leading backslash (matches `MacroDef.name`'s convention).
`arity` is the number of required `{}` arguments `insert_with_tabstops`
(`src/rpc/handlers.rs`) turns into tabstops — **use `0`, not a guess, for any
command whose real syntax isn't a fixed run of brace arguments** (TikZ's `\draw`
take `[options] path;`, not `{arg1}{arg2}`; inventing a fake brace shape for it
would be a *wrong* completion, not just an approximate one — same principle 3.3's
own macro-arity parsing already applies). `detail` is optional, one short
independently-worded phrase.

## License

Command *names* and *arity* are the package's functional API surface, not creative
expression — the same reasoning that makes autocomplete for a programming language's
built-in functions uncontroversial regardless of who owns the language's docs. Every
`detail` string here is written fresh in this project's own words, not copied from
any package's actual documentation text, keeping that distinction real rather than
assumed. If a future, larger database ever generates `detail` text by extracting or
paraphrasing substantial passages from a package's own manual, re-examine this
reasoning at that point — it was evaluated for hand-written one-liners, not bulk
extraction.
