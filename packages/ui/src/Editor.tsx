import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";

const PLACEHOLDER = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

export function Editor() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      doc: PLACEHOLDER,
      extensions: [basicSetup],
      parent: hostRef.current,
    });

    return () => view.destroy();
  }, []);

  return <div ref={hostRef} style={{ height: "100%" }} />;
}
