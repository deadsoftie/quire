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

// M0/M1 scaffolding: completions come from texlab (GPL-3.0) until quire-core grows its own index (M3).
function makeCompletionSource(projectId: string, uri: string) {
  return async function texlabCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const word = context.matchBefore(/\\[a-zA-Z]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const line = context.state.doc.lineAt(context.pos);
    const items = await window.quire.complete({
      projectId,
      uri,
      position: { line: line.number - 1, column: context.pos - line.from },
      text: context.state.doc.toString(),
    });
    if (context.aborted) return null;

    return {
      from: word.from + 1, // skip the leading backslash itself
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
  onChange: (text: string) => void;
}

export function Editor({
  initialDoc,
  projectId,
  uri,
  focusMode,
  typewriterMode,
  proseMode,
  onChange,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: initialDoc,
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
        }),
      ],
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
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
