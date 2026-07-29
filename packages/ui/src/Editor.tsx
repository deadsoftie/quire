import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  focusCompartment,
  focusModeExtension,
  proseCompartment,
  proseModeExtension,
  typewriterCompartment,
  typewriterScrollingExtension,
} from "./editorModes";
import { latex } from "./latex/language";

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
  },
  { dark: true },
);

// Completions come from quire-core's own index as of 3.1-3.4 (label/\ref, citation/\cite,
// bare-command macro, and file-path completion; texlab is no longer called at all --
// packages/client/src/texlabClient.ts is inert scaffolding pending 3.12's deletion). Two trigger
// shapes feed the same request: typing inside a recognized command's brace argument
// (\ref/\eqref/\autoref/\cite/\input/\include/\includegraphics -- the optional `(\[...\])?` group
// tolerates \includegraphics[width=5cm]{ and even plain LaTeX's own \cite[note]{, both of which
// take an optional bracket before the brace), or a bare backslash for command-name completion
// (macros as of 3.3; 3.5's CTAN commands merge into the same server-side response later, ranked
// below project-local macros -- no client change needed for that either). Each trigger request
// spawns a fresh quire-sidecar process (see sidecarProcess.ts's runOnce) -- fine once per
// word/argument, since CM6 filters locally against the already-fetched list as more of it is
// typed, not on every keystroke.
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
      options: items.map((item) => ({ label: item.label, detail: item.detail ?? undefined, apply: item.insert })),
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
  /** Session-restore only -- a character offset, clamped to the doc. `null`/undefined starts at 0, same as before session restore existed. */
  restoreCursor?: number | null;
  /** Session-restore only, applied a frame after mount so the content it scrolls has actually been laid out. */
  restoreScrollTop?: number | null;
  onChange: (text: string) => void;
  /** Fires on cursor movement and on scroll, for session restore to persist -- not on every keystroke by itself (docChanged alone doesn't move the cursor). */
  onCursorActivity?: (cursor: number, scrollTop: number) => void;
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
        autocompletion({ override: [makeCompletionSource(projectId, uri)] }),
        proseCompartment.of(proseMode ? proseModeExtension() : []),
        typewriterCompartment.of(typewriterMode ? typewriterScrollingExtension() : []),
        focusCompartment.of(focusMode ? focusModeExtension() : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            onCursorActivityRef.current?.(update.state.selection.main.head, update.view.scrollDOM.scrollTop);
          }
        }),
        EditorView.domEventHandlers({
          scroll: (_event, editorView) => {
            onCursorActivityRef.current?.(editorView.state.selection.main.head, editorView.scrollDOM.scrollTop);
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
