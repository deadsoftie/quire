import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { latex } from "./latex/language";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

// M0/M1 scaffolding: completions come from texlab (GPL-3.0, spawned by
// apps/desktop/src/completion.js) until quire-core grows its own index
// (M3). Only replaces the word after the last backslash -- texlab's own
// textEdit ranges aren't used, this is a simpler stand-in good enough to
// prove the popup works end to end.
async function texlabCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
  const word = context.matchBefore(/\\[a-zA-Z]*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const character = context.pos - line.from;
  const items = await window.quire.complete(context.state.doc.toString(), line.number - 1, character);
  if (context.aborted) return null;

  return {
    from: word.from + 1, // skip the leading backslash itself
    options: items.map((item) => ({ label: item.label, detail: item.detail, apply: item.label })),
  };
}

interface EditorProps {
  initialDoc: string;
  onChange: (text: string) => void;
}

export function Editor({ initialDoc, onChange }: EditorProps) {
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
        latex(),
        autocompletion({ override: [texlabCompletionSource] }),
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
    // initialDoc is only used to seed the view on mount; the caller
    // remounts (via `key`) when it wants a different starting doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
