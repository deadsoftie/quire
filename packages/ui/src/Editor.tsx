import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";

export const INITIAL_SOURCE =
  "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

export function Editor({ onSave }: { onSave: (text: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: INITIAL_SOURCE,
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: "Mod-s",
            run: (view) => {
              onSaveRef.current(view.state.doc.toString());
              return true;
            },
          },
        ]),
      ],
      parent: hostRef.current,
    });

    return () => view.destroy();
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
