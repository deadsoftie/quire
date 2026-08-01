# Quire user guide

Quire is a local-first LaTeX editor: a live-updating PDF preview next to a code editor,
built-in autocomplete for LaTeX commands/labels/citations/packages, and no server —
everything compiles on your machine, offline by default.

This guide covers everything the app does, from a user's point of view. For how it's
built, see [`dev-wiki/`](../dev-wiki/README.md) instead.

## Contents

1. [Getting started](getting-started.md) — opening a folder, starting a new project, your first compile
2. [Projects](projects.md) — what a "project" is, root-document detection, the Explorer's file graph
3. [The editor](editor.md) — syntax highlighting, autocomplete, snippets, environment sync, symbol preview, image paste
4. [Formatting](formatting.md) — Format Document and format-on-save
5. [Files and tabs](files-and-tabs.md) — new/open/save, the tab bar, closing files
6. [PDF preview](preview.md) — live preview, zoom, incremental re-render, color inversion
7. [Compiling](compiling.md) — engines, the Problems panel, missing packages, the Packages panel
8. [Editing modes](editing-modes.md) — Focus mode, Typewriter scrolling, Serif prose mode, Word wrap
9. [Navigation](navigation.md) — Explorer, Outline, the command palette
10. [Export](export.md) — exporting the compiled PDF and the project source
11. [Settings](settings.md) — theme, System TeX
12. [Keyboard shortcuts](keyboard-shortcuts.md) — the full reference table

## The short version

Open a folder with a `.tex` file in it (or start a new project from a blank document or
a template), and Quire finds the root document, compiles it, and shows the PDF next to
the editor. Every edit recompiles automatically. There's no save-then-build step to
remember — the preview reflects what's in the editor, saved or not.
