# Export

**Export…** (⇧⌘E, File menu or command palette) gets the compiled PDF out of Quire and
into a location of your choosing.

## How it works

1. A small dialog appears with one checkbox: **Include source files**.
2. Quire compiles fresh first - always, even if nothing looks like it changed - so
   what you export is guaranteed to match what's currently in the editor, including
   any unsaved changes.
3. A native save dialog appears.

## Without "Include source files"

You get a single `.pdf` file, saved wherever you choose (your Documents folder by
default).

## With "Include source files"

You get a `.zip` instead, containing:

- the compiled PDF at the top level
- every file in the project (everything the Explorer shows, plus `.bib` files) under a
  `source/` folder, exactly as it currently stands - including live text from any open,
  unsaved tab, not the stale on-disk copy

This is meant for sharing or archiving a self-contained snapshot of the whole project,
not just the final PDF.

## What's not included

Compiled-away build artifacts (Tectonic's own intermediate files, the `.quire/build/`
folder itself) are never part of the export - only your real source files and the
final PDF.
