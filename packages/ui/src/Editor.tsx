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

// `{ dark: true }` is more than a flag here: @codemirror/autocomplete's base theme gates its
// popup colors behind CM6's internal `&dark` scope class, which only gets added when some
// registered theme declares one -- without it the autocomplete popup gets no background at all.
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
    ".cm-symbolPreview": {
      padding: "10px 14px",
      fontSize: "1.6em",
      textAlign: "center",
    },
  },
  { dark: true },
);

function makeCompletionSource(projectId: string, uri: string) {
  return async function coreCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const argMatch = context.matchBefore(/\\(ref|eqref|autoref|cite|input|include|includegraphics)(\[[^\]]*\])?\{[^{}\n]*/);
    const wordMatch = context.matchBefore(/\\[a-zA-Z]*/);

    let from: number;
    if (argMatch) {
      from = argMatch.from + argMatch.text.indexOf("{") + 1;
    } else if (wordMatch && (wordMatch.from !== wordMatch.to || context.explicit)) {
      from = wordMatch.from + 1;
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
      // sortPriority is ascending (lower = higher priority); CM6's own boost is the opposite
      // sense (higher = higher priority), hence the negation below.
      options: items.map((item) => ({
        label: item.label,
        detail: item.detail ?? undefined,
        apply: item.insert.includes("${") ? snippet(item.insert) : item.insert,
        boost: -item.sortPriority,
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
  restoreCursor?: number | null;
  // Applied a frame after mount so the content it scrolls has actually been laid out.
  restoreScrollTop?: number | null;
  onChange: (text: string) => void;
  // line/column here are 1-based (StatusBar's convention), distinct from the 0-based UTF-16
  // columns Position uses on the wire.
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
