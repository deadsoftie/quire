import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

export interface EditorHandle {
  /** Selects the given 1-indexed source line and scrolls it into view. */
  jumpToLine: (line: number) => void;
}

interface EditorProps {
  initialDoc: string;
  onChange: (text: string) => void;
  onCursorLine: (line: number) => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { initialDoc, onChange, onCursorLine },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorLineRef = useRef(onCursorLine);
  onCursorLineRef.current = onCursorLine;

  useImperativeHandle(ref, () => ({
    jumpToLine(line) {
      const view = viewRef.current;
      if (!view) return;
      const clamped = Math.min(Math.max(line, 1), view.state.doc.lines);
      const lineInfo = view.state.doc.line(clamped);
      view.dispatch({
        selection: { anchor: lineInfo.from, head: lineInfo.to },
        scrollIntoView: true,
      });
      view.focus();
    },
  }));

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: initialDoc,
      extensions: [
        basicSetup,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            onCursorLineRef.current(line);
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
    // initialDoc is only used to seed the view on mount; the caller
    // remounts (via `key`) when it wants a different starting doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
});
