# Editing modes

Four independent toggles, all in the View menu (and the command palette), for writing
rather than editing sessions. Each is a plain on/off switch — mix and match freely, and
your choices persist across restarts.

## Focus mode

Dims every paragraph except the one your cursor is in. A paragraph is whatever's
between blank lines (or the whole document, if there are no blank lines) — the current
one stays at full contrast, everything else fades to about a third opacity.

## Typewriter scrolling

Keeps your cursor vertically centered in the editor as you type or move around, instead
of letting it drift toward the bottom of the visible area — the page scrolls to you,
not the other way around.

## Serif prose mode

Switches the editor's font to a serif typeface at a larger size with more generous line
height — closer to reading a manuscript than staring at monospaced code. Doesn't affect
the compiled PDF in any way, purely how the source looks while you write it.

## Word wrap

Wraps long lines to fit the editor's width instead of requiring horizontal scrolling.
Off by default (LaTeX source is often written with one sentence per line, which doesn't
need wrapping), but useful for prose-heavy documents.
