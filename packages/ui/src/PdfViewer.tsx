import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { shouldRenderPage } from "./pdfPageRender";
import { resolveScale, stepZoomPercent, type ZoomMode } from "./pdfZoom";
import "./PdfViewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// How far past the viewport a page mounts/renders before it's on screen, to avoid a flash of the empty placeholder.
const ROOT_MARGIN = "800px 0px";

interface RenderTask {
  cancel(): void;
  promise: Promise<unknown>;
}

interface PageSize {
  width: number;
  height: number;
}

// pdf.js throws if render() is called again on a canvas before the previous call finished, so each page's in-flight task is cancelled before starting a new one.
async function renderPageOnto(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  tasks: Map<number, RenderTask>,
  scale: number,
) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // Bitmap resolution can exceed the CSS-visible size (still governed by the wrapper's inline
  // width/height, unaffected below) so retina displays don't get a blurry render at 100%/fit-width.
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  const context = canvas.getContext("2d")!;
  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

  tasks.get(pageNumber)?.cancel();

  const task = page.render({ canvasContext: context, viewport, transform }) as unknown as RenderTask;
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
  /** Pages changed since the immediately preceding compile; a first-ever compile already reports every page (quire-core's own fallback), so no separate "first load" case is needed here. */
  changedPages: number[];
  /** Independent of app theme -- inverted figures often look wrong, so this is never derived from it. */
  inverted: boolean;
}

export function PdfViewer({ data, changedPages, inverted }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  // Natural size (viewport at scale 1) per page -- doesn't change with zoom or pane resizing, only
  // when the document itself changes.
  const [naturalSizes, setNaturalSizes] = useState<Map<number, PageSize>>(new Map());
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width");

  const scrollRootRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wrapperRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const renderTasks = useRef(new Map<number, RenderTask>());
  // Which pdfDoc each page's *current* canvas element last painted -- a fresh element (see setCanvasRef) always needs a fresh draw.
  const renderedForDocRef = useRef(new Map<number, PDFDocumentProxy>());
  // The doc a page's bitmap must match for changedPages' skip to be valid -- see shouldRenderPage.
  const previousPdfDocRef = useRef<PDFDocumentProxy | null>(null);
  // Detects "the render resolution itself must change" (zoom/resize), which shouldRenderPage's
  // doc-identity check knows nothing about -- see the render effect below.
  const lastScaleKeyRef = useRef<string | null>(null);

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

  // Metadata-only, fetched once so every placeholder reserves its real space -- without this, mounting/unmounting canvases while scrolling would shift the scroll position.
  useEffect(() => {
    if (!pdfDoc) {
      setNaturalSizes(new Map());
      return;
    }
    let cancelled = false;
    const doc = pdfDoc;
    Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => {
        const pageNumber = i + 1;
        return doc.getPage(pageNumber).then((page): [number, PageSize] => {
          const viewport = page.getViewport({ scale: 1 });
          return [pageNumber, { width: viewport.width, height: viewport.height }];
        });
      }),
    ).then((entries) => {
      if (!cancelled) setNaturalSizes(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc]);

  // Tracks the pane's own available width, for "fit-width" -- resizing the window or dragging the
  // editor/preview seam both need to re-fit the page.
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContainerWidth(width);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

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

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    const doc = pdfDoc;
    const changedSet = new Set(changedPages);

    // The doc hasn't changed but the render resolution has (zoom or pane width) -- every visible
    // page's existing bitmap is now the wrong size, regardless of what shouldRenderPage's
    // doc-identity check would otherwise conclude.
    const scaleKey = `${zoomMode}:${containerWidth}`;
    if (lastScaleKeyRef.current !== scaleKey) {
      lastScaleKeyRef.current = scaleKey;
      renderedForDocRef.current.clear();
    }

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

        const natural = naturalSizes.get(pageNumber);
        const scale = resolveScale(zoomMode, containerWidth, natural?.width ?? 0);
        await renderPageOnto(doc, pageNumber, canvas, renderTasks.current, scale);
        if (cancelled) return;
        renderedForDocRef.current.set(pageNumber, doc);
      }
      if (!cancelled) previousPdfDocRef.current = doc;
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, changedPages, visiblePages, zoomMode, containerWidth, naturalSizes]);

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
      // A canvas mounted here again later starts blank and needs its own fresh render.
      renderedForDocRef.current.delete(pageNumber);
      return;
    }
    canvasRefs.current.set(pageNumber, el);
    // Rendering is left to the effect above, which re-runs right after this fires.
  }

  const numPages = pdfDoc?.numPages ?? 0;
  const pageNumbers = Array.from({ length: numPages }, (_, i) => i + 1);

  // Any page's natural width is a reasonable stand-in for the whole document's -- real-world
  // documents essentially never mix page widths, and the zoom control shows one figure regardless.
  const firstNaturalWidth = naturalSizes.get(1)?.width ?? 0;
  const currentPercent = Math.round(resolveScale(zoomMode, containerWidth, firstNaturalWidth) * 100);

  function zoomBy(direction: 1 | -1) {
    setZoomMode(stepZoomPercent(currentPercent, direction));
  }

  return (
    <div className="pdf-viewer-container">
      <div ref={scrollRootRef} className="pdf-viewer">
        {pageNumbers.map((pageNumber) => {
          const natural = naturalSizes.get(pageNumber);
          const scale = natural ? resolveScale(zoomMode, containerWidth, natural.width) : 0;
          const size = natural ? { width: natural.width * scale, height: natural.height * scale } : undefined;
          const isVisible = visiblePages.has(pageNumber);
          return (
            <div
              key={pageNumber}
              data-page-number={pageNumber}
              ref={(el) => setWrapperRef(pageNumber, el)}
              className={inverted ? "pdf-viewer__page pdf-viewer__page--inverted" : "pdf-viewer__page"}
              style={size ? { width: size.width, height: size.height } : undefined}
            >
              {isVisible && size && (
                <canvas ref={(el) => setCanvasRef(pageNumber, el)} className="pdf-viewer__canvas" />
              )}
            </div>
          );
        })}
      </div>
      {pdfDoc && (
        <div className="pdf-zoom">
          <button type="button" className="pdf-zoom__button" onClick={() => zoomBy(-1)} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            className="pdf-zoom__label"
            onClick={() => setZoomMode("fit-width")}
            title="Reset to Fit Width"
          >
            {zoomMode === "fit-width" ? "Fit Width" : `${currentPercent}%`}
          </button>
          <button type="button" className="pdf-zoom__button" onClick={() => zoomBy(1)} aria-label="Zoom in">
            +
          </button>
        </div>
      )}
    </div>
  );
}
