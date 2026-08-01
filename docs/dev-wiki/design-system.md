# Design system (`packages/design`)

## The concept (`QUIRE_SPEC.md` §7)

The design direction comes from print production, not generic app design: **the PDF is
the only white surface in the application.** Everything else — sidebar, tabs, status
bar — is press furniture, the metal and ink around the paper. Chrome recedes; the
document is the hero.

The accent color, `--nonrepro`, is **non-photo blue** — the color print production
actually uses for guide marks that don't reproduce when printed or photographed. It's
literally "the color of guidance that disappears from the final document," which is
the whole product thesis in one token: it's what carries selection and interactive
focus throughout the UI, precisely because it's the color of things that are *help*,
not *content*.

`--proof-red`/`--proof-amber` (errors/warnings) follow the same logic: a proofreader's
correction marks, not a generic red/orange.

## Tokens (`tokens.css`)

```
--ink-900/800/700/600   surfaces: app background, panels, raised/hover, borders
--type-hi/mid/lo        text, three levels of emphasis
--nonrepro / -dim       the one accent color, plus a translucent variant for backgrounds
--proof-red / -amber    errors / warnings
--paper                 #ffffff, always — the PDF surface, never tinted even in light mode
--t-xs..--t-xl          type scale (11/13/14/17/22/27px, roughly a 1.25 ratio)
--s-1..--s-12           spacing scale (4/8/12/16/24/32/48px)
--radius, --seam        5px corner radius; 1px hairline width
```

`--nonrepro` itself is identical between dark and light mode (`#8fc7e8`) — only the
surfaces/text/error tokens swap per theme, switched via `[data-theme="dark"]`/
`[data-theme="light"]` on `:root`. `--proof-red`/`--proof-amber` and the syntax
highlighting `--ink-green/gold/orange/purple/cyan/brown` family both get **separately
tuned, darker/more saturated values in light mode** — the dark-mode values drop below
WCAG AA's 4.5:1 contrast ratio against light-mode's lighter surfaces, so light mode
isn't just "the same colors, different background."

## Syntax highlighting's own palette

The `--ink-green/gold/orange/purple/cyan/brown` family exists specifically because
`--nonrepro`/`--type-*` alone can't distinguish enough categories (comments, section
headings, references, environments, verbatim content, math) for real code
highlighting. These went through one real revision: an initial pass used muted
pastels close in lightness to surrounding text, which read as "barely there" once
actually visible on screen — the current values are deliberately vivid (closer to a
One Dark/Dracula register) specifically to read clearly against `--ink-900`/`--ink-800`,
not a pastel variant of the base accent. See
[Editor internals](editor-internals.md) for where these apply.

## Two copies, kept in sync by hand

`tokens.css` (CSS custom properties) is the real source; `index.ts` is a **hand-
maintained JS mirror** of the same values, for anything that needs them as JS rather
than CSS — its own comment says so. A token value change means updating both files;
nothing generates one from the other.
