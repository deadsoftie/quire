import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion, snippet } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  focusCompartment,
  focusModeExtension,
  proseCompartment,
  proseModeExtension,
  typewriterCompartment,
  typewriterScrollingExtension,
} from "./editorModes";
import { environmentSync } from "./environmentSync";
import { latex } from "./latex/language";
import { snippetCompletionSource } from "./snippets";
import { renderSymbolPreview } from "./symbolPreview";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

// Without this, CM6 renders with its own default light theme and sizes
// itself to content height instead of filling the pane -- both very
// visible against the rest of the app's dark, fixed two-pane layout.
// `{ dark: true }` matters beyond a flag: @codemirror/view and
// @codemirror/autocomplete's own base themes gate tooltip/popup colors
// behind CM6's internal `&light`/`&dark` scope classes, which only get
// added when *some* registered theme declares one or the other -- without
// it the autocomplete popup falls through to no background at all, not
// even CM6's own generic dark gray.
const baseEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--ink-900)",
      color: "var(--type-hi)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      fontFamily: "var(--editor-font)",
      fontSize: "var(--editor-size)",
      lineHeight: "var(--editor-line-height)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--ink-900)",
      color: "var(--type-lo)",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--ink-800)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--ink-800)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--nonrepro-dim)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--nonrepro)",
    },
    ".cm-tooltip": {
      border: "var(--seam) solid var(--ink-600)",
      backgroundColor: "var(--ink-800)",
      color: "var(--type-hi)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "var(--nonrepro-dim)",
      color: "var(--nonrepro)",
    },
    ".cm-completionDetail": {
      color: "var(--type-mid)",
    },
    ".cm-completionMatchedText": {
      color: "var(--nonrepro)",
      textDecoration: "none",
      fontWeight: "600",
    },
    // 3.8: KaTeX's own generated markup inherits color from here rather than carrying its own --
    // .cm-completionInfo is itself a .cm-tooltip (see renderSymbolPreview), so border/background
    // already match; this just sizes and centers the rendered glyph within that popup.
    ".cm-symbolPreview": {
      padding: "10px 14px",
      fontSize: "1.6em",
      textAlign: "center",
    },
  },
  { dark: true },
);

// Completions come from quire-core's own index as of 3.1-3.5 (label/\ref, citation/\cite,
// bare-command macro and CTAN package, and file-path completion; texlab is no longer called at
// all -- packages/client/src/texlabClient.ts is inert scaffolding pending 3.12's deletion). Two
// trigger shapes feed the same request: typing inside a recognized command's brace argument
// (\ref/\eqref/\autoref/\cite/\input/\include/\includegraphics -- the optional `(\[...\])?` group
// tolerates \includegraphics[width=5cm]{ and even plain LaTeX's own \cite[note]{, both of which
// take an optional bracket before the brace), or a bare backslash for command-name completion
// (macros as of 3.3, merged with 3.5's CTAN package commands server-side and ranked via
// `sortPriority` -> CM6's `boost` below). Each trigger request spawns a fresh quire-sidecar
// process (see sidecarProcess.ts's runOnce) -- fine once per word/argument, since CM6 filters
// locally against the already-fetched list as more of it is typed, not on every keystroke.
function makeCompletionSource(projectId: string, uri: string) {
  return async function coreCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const argMatch = context.matchBefore(/\\(ref|eqref|autoref|cite|input|include|includegraphics)(\[[^\]]*\])?\{[^{}\n]*/);
    const wordMatch = context.matchBefore(/\\[a-zA-Z]*/);

    let from: number;
    if (argMatch) {
      from = argMatch.from + argMatch.text.indexOf("{") + 1;
    } else if (wordMatch && (wordMatch.from !== wordMatch.to || context.explicit)) {
      from = wordMatch.from + 1; // skip the leading backslash itself
    } else {
      return null;
    }

    const line = context.state.doc.lineAt(context.pos);
    const items = await window.quire.complete({
      projectId,
      uri,
      position: { line: line.number - 1, column: context.pos - line.from },
      text: context.state.doc.toString(),
    });
    if (context.aborted || items.length === 0) return null;

    return {
      from,
      // sortPriority is ascending (lower = higher priority, Section 9.4); CM6's own boost is the
      // opposite sense (higher = higher priority), -99..99. Without this, items were already
      // ordered correctly within a single trigger's own uniform priority (labels, citations, each
      // always the same tier), so the gap was invisible until 3.5 put two tiers -- project-local
      // macros and package commands -- in the same response for the first time.
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail ?? undefined,
        // 3.3/3.5's macro/package arity tabstops are `${1:...}` too (Section 6) -- route them
        // through the same CM6 snippet mechanism 3.7 wires up, rather than inserting the literal
        // placeholder text for everything but the new local snippet source.
        apply: item.insert.includes("${") ? snippet(item.insert) : item.insert,
        boost: -item.sortPriority,
        // 3.8: math symbols carry `symbolPreview` (TeX source, e.g. "\\alpha"); everything else
        // leaves this undefined, so CM6 shows no info panel at all rather than an empty one.
        info: item.symbolPreview ? () => renderSymbolPreview(item.symbolPreview!) : undefined,
      })),
    };
  };
}

interface EditorProps {
  initialDoc: string;
  projectId: string;
  uri: string;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  /** Where this tab's cursor was last -- app-launch session restore, or just switching back to an
   * already-open tab (3.5.3), both apply this the same way: a character offset, clamped to the
   * doc, applied fresh on every mount. `null`/undefined starts at 0. */
  restoreCursor?: number | null;
  /** Same as `restoreCursor` but for scroll position; applied a frame after mount so the content it scrolls has actually been laid out. */
  restoreScrollTop?: number | null;
  onChange: (text: string) => void;
  /** Fires on cursor movement and on scroll, for session restore (cursor/scrollTop) and the status
   * bar (line/column, 1-based -- StatusBar's own display convention, distinct from the 0-based
   * UTF-16 columns Position uses on the wire) to persist -- not on every keystroke by itself
   * (docChanged alone doesn't move the cursor). */
  onCursorActivity?: (cursor: number, scrollTop: number, line: number, column: number) => void;
}

export function Editor({
  initialDoc,
  projectId,
  uri,
  focusMode,
  typewriterMode,
  proseMode,
  restoreCursor,
  restoreScrollTop,
  onChange,
  onCursorActivity,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorActivityRef = useRef(onCursorActivity);
  onCursorActivityRef.current = onCursorActivity;

  useEffect(() => {
    if (!hostRef.current) return;

    const cursor = Math.max(0, Math.min(restoreCursor ?? 0, initialDoc.length));

    const view = new EditorView({
      doc: initialDoc,
      selection: { anchor: cursor },
      extensions: [
        basicSetup,
        baseEditorTheme,
        latex(),
        environmentSync(),
        autocompletion({ override: [makeCompletionSource(projectId, uri), snippetCompletionSource] }),
        proseCompartment.of(proseMode ? proseModeExtension() : []),
        typewriterCompartment.of(typewriterMode ? typewriterScrollingExtension() : []),
        focusCompartment.of(focusMode ? focusModeExtension() : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorActivityRef.current?.(head, update.view.scrollDOM.scrollTop, line.number, head - line.from + 1);
          }
        }),
        EditorView.domEventHandlers({
          scroll: (_event, editorView) => {
            const head = editorView.state.selection.main.head;
            const line = editorView.state.doc.lineAt(head);
            onCursorActivityRef.current?.(head, editorView.scrollDOM.scrollTop, line.number, head - line.from + 1);
          },
        }),
      ],
      parent: hostRef.current,
    });
    viewRef.current = view;

    let restoreRafId: number | null = null;
    if (restoreScrollTop) {
      restoreRafId = requestAnimationFrame(() => {
        restoreRafId = null;
        view.scrollDOM.scrollTop = restoreScrollTop;
      });
    }

    return () => {
      if (restoreRafId !== null) cancelAnimationFrame(restoreRafId);
      view.destroy();
      viewRef.current = null;
    };
    // Props only seed the view on mount; the caller remounts (via `key`) to change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: proseCompartment.reconfigure(proseMode ? proseModeExtension() : []) });
  }, [proseMode]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: typewriterCompartment.reconfigure(typewriterMode ? typewriterScrollingExtension() : []),
    });
  }, [typewriterMode]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: focusCompartment.reconfigure(focusMode ? focusModeExtension() : []) });
  }, [focusMode]);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
