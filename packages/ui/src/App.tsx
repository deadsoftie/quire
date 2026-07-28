import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, INITIAL_SOURCE } from "./Editor";
import type { EditorHandle } from "./Editor";
import { PdfViewer } from "./PdfViewer";
import type { SyncRect } from "./quire-bridge";

const DEBOUNCE_MS = 500;
const FORWARD_SYNC_DEBOUNCE_MS = 50;

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
  const [initialDoc, setInitialDoc] = useState(INITIAL_SOURCE);
  const [projectLabel, setProjectLabel] = useState<string | null>(null);
  const [docVersion, setDocVersion] = useState(0);
  const [highlightRects, setHighlightRects] = useState<SyncRect[] | null>(null);
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);
  const forwardSyncDebounceRef = useRef<number | undefined>(undefined);
  const editorRef = useRef<EditorHandle>(null);

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

  // Forward sync: editor cursor -> PDF highlight. Debounced lightly since
  // arrow-key repeat can fire this very rapidly; each call is independent
  // (see sidecar.js), so out-of-order responses are a non-issue in
  // practice at this debounce window.
  const onCursorLine = useCallback((line: number) => {
    if (forwardSyncDebounceRef.current !== undefined) {
      window.clearTimeout(forwardSyncDebounceRef.current);
    }
    forwardSyncDebounceRef.current = window.setTimeout(() => {
      window.quire.forwardSync(line).then((result) => {
        setHighlightRects(result?.rects ?? null);
      });
    }, FORWARD_SYNC_DEBOUNCE_MS);
  }, []);

  // Inverse sync: click in the PDF -> editor jumps to and selects the
  // corresponding source line. When the click resolves to a different
  // file than the one currently open (e.g. a different chapter), main.js
  // returns its content and the editor switches to show it -- the jump
  // has to wait until *that* remount happens (see the effect below),
  // since editorRef briefly points at nothing/the old instance otherwise.
  const onInverseSync = useCallback((page: number, x: number, y: number) => {
    window.quire.inverseSync(page, x, y).then((result) => {
      if (!result) return;

      if (result.switchedFile) {
        setInitialDoc(result.switchedFile.text);
        setProjectLabel(result.switchedFile.relativePath);
        setDocVersion((v) => v + 1);
        setHighlightRects(null);
        setPendingJumpLine(result.line);
      } else {
        editorRef.current?.jumpToLine(result.line);
      }
    });
  }, []);

  // Applies a jump queued by a file switch once the new Editor (remounted
  // via the bumped docVersion key) has actually mounted.
  useEffect(() => {
    if (pendingJumpLine === null) return;
    editorRef.current?.jumpToLine(pendingJumpLine);
    setPendingJumpLine(null);
  }, [docVersion, pendingJumpLine]);

  useEffect(() => {
    runCompile(INITIAL_SOURCE);
    // Only the very first mount uses the placeholder doc; openProject()
    // drives subsequent compiles directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = useCallback(async () => {
    const result = await window.quire.openProject().catch((err) => {
      setError(String(err?.message ?? err));
      return null;
    });
    if (!result) return;

    setInitialDoc(result.initialText);
    setProjectLabel(result.rootRelativePath);
    setDocVersion((v) => v + 1);
    setHighlightRects(null);
    runCompile(result.initialText);
  }, [runCompile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100vw", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          fontFamily: "sans-serif",
          fontSize: 12,
          color: "#888",
        }}
      >
        <button onClick={openProject}>Open Project…</button>
        <span>{projectLabel ?? "(no project open -- editing a throwaway placeholder)"}</span>
        <span>{status === "compiling" ? "compiling…" : ""}</span>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={paneStyle}>
          <Editor
            key={docVersion}
            ref={editorRef}
            initialDoc={initialDoc}
            onChange={scheduleCompile}
            onCursorLine={onCursorLine}
          />
        </div>
        <div style={{ width: 1, background: "#888" }} />
        <div style={paneStyle}>
          {error ? (
            <pre style={{ color: "red", padding: 8, whiteSpace: "pre-wrap" }}>{error}</pre>
          ) : (
            <PdfViewer data={pdfData} highlightRects={highlightRects} onInverseSync={onInverseSync} />
          )}
        </div>
      </div>
    </div>
  );
}
