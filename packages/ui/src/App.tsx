import { useCallback, useEffect, useState } from "react";
import { Editor, INITIAL_SOURCE } from "./Editor";
import { PdfViewer } from "./PdfViewer";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const paneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  overflow: "auto",
};

// M0 spike: compiling on every keystroke (0.3) was too jittery without
// debounce/cancellation (0.4). Until that lands, compile is manual: Cmd/Ctrl-S.
export function App() {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "compiling">("idle");

  const compile = useCallback((source: string) => {
    setStatus("compiling");
    window.quire.compile(source).then(
      (result) => {
        setError(null);
        setPdfData(base64ToBytes(result.pdfBase64));
        setStatus("idle");
      },
      (err) => {
        setError(String(err?.message ?? err));
        setStatus("idle");
      },
    );
  }, []);

  useEffect(() => {
    compile(INITIAL_SOURCE);
  }, [compile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh" }}>
      <div style={{ padding: "4px 8px", fontFamily: "sans-serif", fontSize: 12, color: "#888" }}>
        Cmd/Ctrl-S to compile {status === "compiling" ? "· compiling…" : ""}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={paneStyle}>
          <Editor onSave={compile} />
        </div>
        <div style={{ width: 1, background: "#888" }} />
        <div style={paneStyle}>
          {error ? (
            <pre style={{ color: "red", padding: 8, whiteSpace: "pre-wrap" }}>{error}</pre>
          ) : (
            <PdfViewer data={pdfData} />
          )}
        </div>
      </div>
    </div>
  );
}
