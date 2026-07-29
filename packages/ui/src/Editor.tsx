import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { latex } from "./latex/language";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

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
  onChange: (text: string) => void;
}

export function Editor({ initialDoc, projectId, uri, onChange }: EditorProps) {
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
        autocompletion({ override: [makeCompletionSource(projectId, uri)] }),
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

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
