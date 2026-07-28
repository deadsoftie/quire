import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, INITIAL_SOURCE } from "./Editor";
import { PdfViewer } from "./PdfViewer";

const DEBOUNCE_MS = 500;

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

export function App() {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "compiling">("idle");
  const debounceRef = useRef<number | undefined>(undefined);

  // Sending a new compile request kills whatever the sidecar is still
  // running (see apps/desktop/src/sidecar.js), so a superseded request's
  // promise never settles -- no risk of a stale result overwriting a
  // newer one here.
  const runCompile = useCallback((source: string) => {
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

  const scheduleCompile = useCallback(
    (source: string) => {
      if (debounceRef.current !== undefined) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => runCompile(source), DEBOUNCE_MS);
    },
    [runCompile],
  );

  useEffect(() => {
    runCompile(INITIAL_SOURCE);
  }, [runCompile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh" }}>
      <div style={{ padding: "4px 8px", fontFamily: "sans-serif", fontSize: 12, color: "#888" }}>
        {status === "compiling" ? "compiling…" : ""}
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={paneStyle}>
          <Editor onChange={scheduleCompile} />
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
