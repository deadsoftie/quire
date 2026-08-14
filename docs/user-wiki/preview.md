# PDF preview

The right-hand pane shows the compiled PDF, kept in sync with the editor automatically
- there's no separate "build" step (see [Compiling](compiling.md) for when
recompiles actually happen).

## Zoom

A small zoom control sits at the bottom of the preview:

- **−** / **+** step the zoom by 10%, clamped between 25% and 400%.
- The percentage label doubles as a button - click it to reset to **Fit Width**
  (the default), which scales each page to fill the pane's width. Fit Width is
  recalculated per page, so a document with mixed page sizes still fits each one
  correctly.

## Incremental re-render

Only pages that actually changed since the last compile are redrawn - editing page 12
of a 40-page document doesn't cause the other 39 to flash or rerender. Pages redraw
automatically at the right resolution for your display (crisp on Retina/HiDPI screens).

## Color inversion

**Invert PDF Colors** (View menu) inverts the preview's colors independently of the
app's own light/dark theme - useful for a dark-on-light document rendered against a
dark theme, without switching the whole app's theme to match.

## Resizing the split

Drag the seam between the editor and preview panes to resize them. Double-click the
seam, focus it and press Enter/Space, or use **Reset Editor/Preview Split** in the View
menu, to reset to an even 50/50 split.
