import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

export function Editor({
  initialDoc,
  onChange,
}: {
  initialDoc: string;
  onChange: (text: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
        }),
      ],
      parent: hostRef.current,
    });

    return () => view.destroy();
    // initialDoc is only used to seed the view on mount; the caller
    // remounts (via `key`) when it wants a different starting doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
