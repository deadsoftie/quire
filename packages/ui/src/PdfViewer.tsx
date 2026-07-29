import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { shouldRenderPage } from "./pdfPageRender";
import "./PdfViewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const SCALE = 1.5;
// How far past the visible viewport (in either scroll direction) a page
// gets mounted and rendered before it's actually on screen, so scrolling
// into it doesn't show a flash of the empty placeholder.
const ROOT_MARGIN = "800px 0px";

interface RenderTask {
  cancel(): void;
  promise: Promise<unknown>;
}

interface PageSize {
  width: number;
  height: number;
}

// The canvas ref callback (mount) and the render effects below can both
// want to render the same page around the same time (e.g. right after a
// project loads); pdf.js throws if render() is called again on a canvas
// before the previous call finished. Tracking one in-flight task per page
// and cancelling it before starting a new one avoids that.
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
  /** `CompileResponse.changedPages` from the compile that produced
   * `data` -- 1-indexed page numbers whose rendered content actually
   * differs from the *immediately preceding* compile. On a document's
   * first-ever compile (or any page-count change), quire-core's own
   * fallback already reports every page here (see
   * `crates/quire-core/src/page_hash.rs`), so this component never
   * needs a separate "first load" special case -- trusting this list
   * literally is always correct. */
  changedPages: number[];
}

export function PdfViewer({ data, changedPages }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());

  const scrollRootRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wrapperRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  // Which pdfDoc each page's *current* canvas element last actually
  // painted -- doc identity, not just page number, since a canvas
  // element is destroyed and recreated each time a page leaves and
  // re-enters `visiblePages` (see setCanvasRef) and a brand new element
  // always needs a fresh draw regardless of what the old one showed.
  const renderedForDocRef = useRef(new Map<number, PDFDocumentProxy>());
  // The doc a page's bitmap would have to match for `changedPages`'
  // incremental skip to be valid at all: "unchanged since last compile"
  // only means something if the bitmap on screen right now *is* last
  // compile's output. A page that was invisible for one or more compiles
  // in between doesn't satisfy that, however old `changedPages` lists
  // looked -- see the doc-change effect below.
  const previousPdfDocRef = useRef<PDFDocumentProxy | null>(null);

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

  // Page sizes, fetched once up front for the whole document -- metadata
  // only (no rasterization), needed so every placeholder (including ones
  // for pages never rendered yet) reserves the *real* space its page
  // will occupy. Without this, mounting/unmounting canvases as they
  // scroll in and out would constantly shift the scrollbar/scroll
  // position, which defeats the point of virtualizing at all. Fetched
  // per-page rather than assumed-uniform-from-page-1 so a document with
  // a mixed-size page (e.g. one landscape figure) still lays out
  // correctly; this is a one-time cost at document load, not a
  // per-scroll-frame one, so it doesn't bear on the 60fps scroll target.
  useEffect(() => {
    if (!pdfDoc) {
      setPageSizes(new Map());
      return;
    }
    let cancelled = false;
    const doc = pdfDoc;
    Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => {
        const pageNumber = i + 1;
        return doc.getPage(pageNumber).then((page): [number, PageSize] => {
          const viewport = page.getViewport({ scale: SCALE });
          return [pageNumber, { width: viewport.width, height: viewport.height }];
        });
      }),
    ).then((entries) => {
      if (!cancelled) setPageSizes(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  // One shared observer for every page's wrapper div, rather than one
  // per page -- pages register/unregister themselves via setWrapperRef.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            const pageNumber = Number(entry.target.getAttribute("data-page-number"));
            if (entry.isIntersecting) {
              if (!next.has(pageNumber)) {
                next.add(pageNumber);
                changed = true;
              }
            } else if (next.delete(pageNumber)) {
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: ROOT_MARGIN, threshold: 0 },
    );
    observerRef.current = observer;
    for (const el of wrapperRefs.current.values()) observer.observe(el);

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  // Runs on every recompile (new pdfDoc) and every visibility change.
  // Decides, per currently-visible page, whether its canvas already
  // shows the right thing or needs a fresh draw -- see the two ref
  // comments above for exactly what "already shows the right thing"
  // means.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    const doc = pdfDoc;
    const changedSet = new Set(changedPages);

    (async () => {
      for (const pageNumber of visiblePages) {
        if (cancelled) return;

        const needsRender = shouldRenderPage({
          lastRenderedDoc: renderedForDocRef.current.get(pageNumber),
          previousDoc: previousPdfDocRef.current,
          currentDoc: doc,
          changedPages: changedSet,
          pageNumber,
        });
        if (!needsRender) continue;

        const canvas = canvasRefs.current.get(pageNumber);
        if (!canvas) continue; // not actually mounted (shouldn't happen, but nothing to draw onto)

        await renderPageOnto(doc, pageNumber, canvas, renderTasks.current);
        if (cancelled) return;
        renderedForDocRef.current.set(pageNumber, doc);
      }
      if (!cancelled) previousPdfDocRef.current = doc;
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, changedPages, visiblePages]);

  function setWrapperRef(pageNumber: number, el: HTMLDivElement | null) {
    const existing = wrapperRefs.current.get(pageNumber);
    if (existing && observerRef.current) observerRef.current.unobserve(existing);

    if (el) {
      wrapperRefs.current.set(pageNumber, el);
      observerRef.current?.observe(el);
    } else {
      wrapperRefs.current.delete(pageNumber);
    }
  }

  function setCanvasRef(pageNumber: number, el: HTMLCanvasElement | null) {
    if (!el) {
      canvasRefs.current.delete(pageNumber);
      // The DOM node that painted this page is gone -- a canvas mounted
      // here again later (even for the *same* doc) starts blank and
      // needs its own fresh render, so nothing here counts as "already
      // rendered" going forward.
      renderedForDocRef.current.delete(pageNumber);
      return;
    }
    canvasRefs.current.set(pageNumber, el);
    // Rendering itself is left to the effect above: this ref callback
    // firing is always immediately followed by that effect re-running
    // (it just became visible, which is what mounted this canvas in the
    // first place), and that effect already knows how to tell "brand new
    // canvas, never rendered" from "unchanged, skip." Rendering here too
    // would just race it -- harmless (renderPageOnto cancels the loser),
    // but pointless duplicate work.
  }

  const numPages = pdfDoc?.numPages ?? 0;
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  return (
    <div ref={scrollRootRef} className="pdf-viewer">
      {pageNumbers.map((pageNumber) => {
        const size = pageSizes.get(pageNumber);
        const isVisible = visiblePages.has(pageNumber);
        return (
          <div
            key={pageNumber}
            data-page-number={pageNumber}
            ref={(el) => setWrapperRef(pageNumber, el)}
            className="pdf-viewer__page"
            style={size ? { width: size.width, height: size.height } : undefined}
          >
            {isVisible && size && (
              <canvas ref={(el) => setCanvasRef(pageNumber, el)} className="pdf-viewer__canvas" />
            )}
          </div>
        );
      })}
    </div>
  );
}
