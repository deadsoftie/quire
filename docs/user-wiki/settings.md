# Settings

Reachable via ⌘, or **Settings…** in the File menu.

## Theme

**Light Theme** (View menu, or the checkbox in Settings) switches between dark and
light. This is independent of [PDF color inversion](preview.md), which only affects the
preview pane.

## Use System TeX for compiling

Only shown as available when Quire actually detects a working TeX Live or MiKTeX
install on your machine (a real `xelatex`/`pdflatex` it could spawn) — if none is found,
the toggle is there but disabled, with a note explaining why.

Turning it on switches compiling from the embedded Tectonic engine to your system
install for every subsequent compile. Useful if you depend on something only your full
TeX Live setup provides. If Quire had previously detected an install but it's gone by
the next time you launch the app, this quietly resets itself off rather than surfacing
an error on your next compile.
