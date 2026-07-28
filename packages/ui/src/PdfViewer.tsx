import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { SyncRect } from "./quire-bridge";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Matches the sync coordinates spec-quoted as "PDF pts" 1:1 -- no separate
// unit conversion needed between the highlight overlay and the canvas.
const SCALE = 1.5;

interface RenderTask {
  cancel(): void;
  promise: Promise<unknown>;
}

// The canvas ref callback (mount) and the "redraw on new pdfDoc" effect
// can both want to render the same page around the same time (e.g. right
// after a project loads); pdf.js throws if render() is called again on a
// canvas before the previous call finished. Tracking one in-flight task
// per page and cancelling it before starting a new one avoids that.
async function renderPageOnto(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  tasks: Map<number, RenderTask>,
) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: SCALE });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d")!;

  tasks.get(pageNumber)?.cancel();

  const task = page.render({ canvasContext: context, viewport }) as unknown as RenderTask;
  tasks.set(pageNumber, task);

  try {
    await task.promise;
  } catch (err) {
    if (err instanceof Error && err.name === "RenderingCancelledException") return;
    throw err;
  } finally {
    if (tasks.get(pageNumber) === task) tasks.delete(pageNumber);
  }
}

interface PdfViewerProps {
  data: Uint8Array | null;
  highlightRects: SyncRect[] | null;
  onInverseSync: (page: number, x: number, y: number) => void;
}

export function PdfViewer({ data, highlightRects, onInverseSync }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderTasks = useRef(new Map<number, RenderTask>());

  useEffect(() => {
    if (!data) {
      setPdfDoc(null);
      return;
    }
    let cancelled = false;
    pdfjsLib.getDocument({ data }).promise.then((doc) => {
      if (!cancelled) setPdfDoc(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Re-renders every already-mounted canvas whenever the document changes
  // (e.g. a recompile) -- ref callbacks alone only fire on mount/unmount,
  // not when `pdfDoc` changes under an already-mounted canvas.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    (async () => {
      for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(pageNumber);
        if (canvas) await renderPageOnto(pdfDoc, pageNumber, canvas, renderTasks.current);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  function setCanvasRef(pageNumber: number, el: HTMLCanvasElement | null) {
    if (!el) {
      canvasRefs.current.delete(pageNumber);
      return;
    }
    canvasRefs.current.set(pageNumber, el);
    if (pdfDoc) renderPageOnto(pdfDoc, pageNumber, el, renderTasks.current);
  }

  function handleClick(pageNumber: number, e: React.MouseEvent<HTMLCanvasElement>) {
    const x = e.nativeEvent.offsetX / SCALE;
    const y = e.nativeEvent.offsetY / SCALE;
    onInverseSync(pageNumber, x, y);
  }

  const numPages = pdfDoc?.numPages ?? 0;
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div>
      {pageNumbers.map((pageNumber) => (
        <div key={pageNumber} style={{ position: "relative", marginBottom: 8 }}>
          <canvas
            ref={(el) => setCanvasRef(pageNumber, el)}
            onClick={(e) => handleClick(pageNumber, e)}
            style={{ display: "block", margin: "0 auto", cursor: "text" }}
          />
          {(highlightRects ?? [])
            .filter((r) => r.page === pageNumber)
            .map((r, i) => (
              <div
                key={i}
                className="quire-sync-highlight"
                style={{
                  position: "absolute",
                  left: r.x * SCALE,
                  top: r.y * SCALE,
                  width: Math.max(r.w * SCALE, 2),
                  height: Math.max(r.h * SCALE, 2),
                  background: "rgba(80,150,255,0.35)",
                  outline: "1px solid rgba(80,150,255,0.7)",
                  pointerEvents: "none",
                }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
