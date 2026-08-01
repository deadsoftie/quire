# Files and tabs

## Creating and opening files

- **New File** (⌘N, or the **+** button in the Explorer's header) opens a native save
  dialog scoped to your project folder, creates an empty file, and opens it as a tab.
  Remember: a new file won't show up in the Explorer tree until something actually
  references it (see [Projects](projects.md)) — the open tab is your record that it
  exists in the meantime.
- **Open File…** (⇧⌘O) opens a native file picker scoped to the project folder, for
  opening a file that already exists but isn't currently referenced/visible.
- **Open Folder…** (⌘O) opens a different project entirely — see
  [Getting started](getting-started.md).

## The tab bar

Every open file gets a tab. A small dot marks unsaved changes. Click a tab to switch to
it, click its **×** to close it — closing a tab with unsaved changes asks first
(Save / Discard / Cancel).

## Saving

- **Save** (⌘S) writes the current file to disk (after formatting it — see
  [Formatting](formatting.md)).
- **Save As…** (⇧⌘S) writes it to a new location via a native save dialog and switches
  the tab to point at the new file.

## Closing

- **Close File** (⌘W) closes the current tab.
- **Close All Files** (⇧⌘W) closes every open tab in one action — one Save/Discard/
  Cancel prompt covering everything unsaved, not one per file. The project stays open;
  you're left looking at an empty editor pane until you open something else.
- **Close Folder** closes the whole project and returns to the welcome screen.

Closing everything down to zero tabs is fine — the project remains open, and the editor
pane just shows a short reminder to pick a file from the Explorer or start a new one.
