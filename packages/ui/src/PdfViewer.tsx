import { useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export function PdfViewer({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      const doc = await pdfjsLib.getDocument(src).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d")!;

      await page.render({ canvasContext: context, viewport }).promise;
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return <canvas ref={canvasRef} style={{ display: "block", margin: "0 auto" }} />;
}
