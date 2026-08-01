# Compiling

## When compiles happen

Automatically, in four situations:

- **Opening** a project or a file.
- **Editing** — about half a second after you stop typing (so a burst of keystrokes
  doesn't trigger a compile per character).
- **Saving.**
- **Exporting** — always forces a fresh compile first, so an exported PDF can never be
  stale relative to what you're looking at. See [Export](export.md).

There's no manual "Compile" button to remember — the preview just stays current.

## Engines

Quire ships with **Tectonic**, a self-contained LaTeX engine, embedded directly in the
app — no separate LaTeX installation needed, and by default it compiles fully offline
against a curated package bundle. If a document needs a package outside that bundle,
Quire fetches it automatically (see below).

If you have a full TeX Live or MiKTeX installation already, you can switch to it in
**Settings…** (⌘,) via **Use System TeX for compiling** — it's only offered when Quire
actually detects a working `xelatex`/`pdflatex` on your system.

## The Problems panel

Compile errors and warnings show up in the **Problems** sidebar section (⌘3), each with
a plain-English explanation (not just the raw LaTeX log line) and, where possible, a
suggested fix. Click a problem to jump straight to its location — opening the right
file first if it isn't already the active tab.

Noise is suppressed automatically: small overfull boxes and "rerun to resolve
references" warnings that would just resolve themselves on the next pass don't show up
unless they persist.

## Missing packages

If a document uses a package outside the offline bundle, a small card appears over the
preview naming what's missing and offering to install it — no error, since nothing has
actually gone wrong yet. If you're offline, it says so and retries automatically the
moment your connection comes back.

## The Packages panel

The **Packages** sidebar section lists everything installed — built-in (part of the
offline bundle) vs. fetched on demand (with their size). Type a package name and press
Enter to install it directly, or remove an on-demand package you no longer need.
