# Projects

A **project** is just a folder. Quire has no project file, no metadata, nothing extra
on disk beyond your own `.tex`/`.bib`/image files (and a `.quire/build/` folder it
manages itself — see below). The filesystem is the project.

## Root-document detection

Every project has one *root document* — the file with `\documentclass` and
`\begin{document}`, the one Quire actually compiles. When you open a folder, Quire
looks for it in order:

1. **An explicit marker.** A `% !TEX root = path/to/main.tex` comment (the TeXShop/
   TeXWorks convention) in any `.tex` file wins outright.
2. **A single `\documentclass`.** If exactly one `.tex` file in the folder has a real
   `\documentclass` (the `subfiles` package's own per-chapter `\documentclass` doesn't
   count), that's the root.
3. **Most references.** If there's more than one candidate, Quire picks whichever one
   `\input`s/`\include`s/`\subfile`s the most other files — a shared preamble file
   included *by* everything else won't win this tiebreak, since out-degree (what it
   references) is what's counted, not in-degree (how often it's referenced).
4. **Ambiguous.** If there's still a tie, Quire can't guess — you'll need to add a
   `% !TEX root` marker to disambiguate.

## The Explorer isn't a folder browser

This is the one thing that surprises people coming from a plain text editor: the
**Explorer** sidebar doesn't show every file in your project folder. It shows the files
*reachable from the root document* — everything pulled in via `\input`, `\include`,
`\subfile`, `\includegraphics`, `\bibliography`, or `\addbibresource`, walked
recursively. A `.tex` file sitting in the folder that nothing references yet won't
appear until you reference it.

This also means a stray `notes.tex` you keep around for scratch writing, or an old
draft you haven't deleted, simply won't clutter the tree — it's invisible until it's
actually part of the document.

`.bib` files and images appear in the tree too, but greyed out ("inert") — there's no
editor support for them yet, so they're not click-to-open.

## The shadow build directory

Quire compiles into `<project>/.quire/build/`, never your actual source files. Every
compile mirrors the current state of every reachable file (including any unsaved edits
sitting in an open tab) into that folder and runs the LaTeX engine there. Your real
files on disk are only ever touched by an explicit Save.

You can safely ignore or gitignore `.quire/`.
