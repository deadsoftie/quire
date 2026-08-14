# Getting started

## First launch

Quire opens to a welcome screen with two choices: **Open Folder…** and **New Project…**.
Nothing is open yet - no editor, no preview - until you pick one.

## Opening an existing project

**Open Folder…** (⌘O) opens a native folder picker. Pick any folder that contains a
`.tex` file. Quire looks for the *root* document - the one with `\documentclass` and
`\begin{document}` - and opens it. See [Projects](projects.md) for exactly how that
detection works and what happens if it's ambiguous.

## Starting a new project

**New Project…** (⇧⌘N) opens a small dialog with five choices:

- **Blank Document** - an empty article to start from scratch
- **Article** - title/author/abstract/section skeleton
- **IEEE** - IEEE conference paper format
- **ACM / SIGCONF** - ACM SIGCONF proceedings format
- **Beamer** - a slide deck presentation

Pick one, then a folder picker appears - choose an empty folder, or create a new one
right there (the picker has its own "New Folder" option). Quire writes a `main.tex`
into it (blank boilerplate, or the template you picked) and opens the project.

The folder has to be empty (aside from things like a stray `.DS_Store`, which don't
count) - Quire won't scaffold into a folder that already has files in it.

## Your first compile

As soon as a project opens, Quire compiles it automatically. Every project starts with
real body content (the blank template isn't literally empty - an empty
`\begin{document}\end{document}` reliably fails to compile), so you should see a PDF in
the preview pane within a couple of seconds.

From here, every edit you make recompiles automatically after a short pause (see
[Compiling](compiling.md)). There's no explicit "build" step.

## Closing a project

**Close Folder** (File menu) returns you to the empty welcome screen. If you have
unsaved changes across multiple files, you'll get one prompt covering all of them
(Save / Discard / Cancel), not one prompt per file.
