import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

export function Editor({ onChange }: { onChange: (text: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: INITIAL_SOURCE,
      extensions: [
        basicSetup,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
      parent: hostRef.current,
    });

    return () => view.destroy();
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
