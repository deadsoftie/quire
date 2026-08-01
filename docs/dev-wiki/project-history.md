# Project history

An index, not a copy, into `QUIRE_SPEC.md` and `M4_TASKS.md` — both are actively
maintained and this page will go stale the moment it tries to restate their content
instead of pointing at it.

## Milestones (`QUIRE_SPEC.md` §8)

| Milestone | Focus |
|---|---|
| M0 — Spike (kill gate) | Prove the core compile loop works at all; throwaway UI |
| M1 — Core API | The RPC contract, frozen at the end of this milestone |
| M2 — Editor and design | Real editor, design system |
| M3 — Own completion | quire-core's own indexing/completion; the GPL-3.0 scaffolding from M0/M1 removed (see `QUIRE_SPEC.md` §2) |
| M3.5 — Workbench layout | The persistent sidebar/tab-bar/status-bar layout, replacing an earlier chrome-less, ⌘K-summoned-panel model |
| M4 — Ship desktop | Current milestone — see `M4_TASKS.md` |
| M5 — Capacitor plugin | iPad groundwork |
| M6 — Ship iPad | |

That removed scaffolding is worth knowing about specifically: it was real scaffolding
through M2, deliberately never a production dependency (its GPL-3.0 license is
incompatible with App Store distribution terms) — `QUIRE_SPEC.md` §2 names it and has
the full licensing table. CI fails if its name is ever reintroduced anywhere outside
`QUIRE_SPEC.md` (deliberately not spelled out on this page, for that reason).

## Non-goals for v1 (`QUIRE_SPEC.md` §3)

Explicitly out of scope, not just unstarted: real-time collaboration, WYSIWYG editing,
Quire's own cloud sync (the filesystem — iCloud/Dropbox/Git — *is* the sync layer),
a plugin API, track changes/comments, Word/HTML export, AI features, a bibliography
**UI** (the index exists in v1; the panel is v1.2+), and a Git panel/submission
packaging/template gallery/spell check (all v1.2+).

Worth internalizing before proposing a feature: "do not add abstractions in
preparation for" these is explicit in the spec, not just an omission.

## Current milestone (`M4_TASKS.md`)

Each M4 task (`4.1`–`4.13`) has, once landed, a "Done" writeup — not just "what," but
the real reasoning behind non-obvious decisions, discovered gaps, and what was
deliberately deferred. That per-task detail is worth reading directly rather than
summarized here; it's written for exactly this purpose. `M4_TASKS.md` itself is deleted
once the whole phase is manually verified — check `QUIRE_SPEC.md` §8 M4's own line if
this file is gone by the time you're reading this.

## Known, disclosed gaps

A few things are documented as *structural*, not oversights — worth distinguishing
from ordinary unfinished work:

- **Precompiled-preamble caching is permanently blocked**, confirmed against Tectonic's
  actual engine, not a workaround-pending situation. `M4_TASKS.md`'s 4.10 (performance)
  task explains this in full before anyone should attempt that budget.
- **`.bib` files aren't independently openable**, even though `FileNodeKind::Bib` makes
  them a real, visible entry in the Explorer and in file iteration (export bundles,
  etc.) — there's just no bib-syntax editor support yet, so they render inert rather
  than click-to-open. See [The contract](the-contract.md).
