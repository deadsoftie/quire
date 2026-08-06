# Settings

Reachable via ⌘, or **Settings…** in the File menu.

## Theme

Reachable three ways:

- **Settings…** (⌘,) — the full picker: swatch grids for built-in dark themes, built-in
  light themes, and **Your Themes** (any you've created). Click a swatch to switch to
  it, or a custom theme's edit/delete controls to manage it. The **New** swatch opens
  the theme editor seeded from whichever theme is currently active, letting you tweak
  individual colors (surfaces, text, accents, syntax highlighting) and save the result
  as a new custom theme.
- **Command palette** (⌘K) — type "theme" for a `Theme: <name>` entry per theme (every
  built-in one, plus any of your own), so switching is one keystroke away without
  opening Settings.
- **View menu → Theme** — a submenu listing the built-in themes only (not custom ones,
  since this is a native menu built once at launch); the current theme is checked.

Switching theme is independent of [PDF color inversion](preview.md), which only affects
the preview pane.

## Use System TeX for compiling

Only shown as available when Quire actually detects a working TeX Live or MiKTeX
install on your machine (a real `xelatex`/`pdflatex` it could spawn) — if none is found,
the toggle is there but disabled, with a note explaining why.

Turning it on switches compiling from the embedded Tectonic engine to your system
install for every subsequent compile. Useful if you depend on something only your full
TeX Live setup provides. If Quire had previously detected an install but it's gone by
the next time you launch the app, this quietly resets itself off rather than surfacing
an error on your next compile.
