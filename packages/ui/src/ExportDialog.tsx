import { useEffect, useState } from "react";
import "./ExportDialog.css";

interface ExportDialogProps {
  onExport: (includeSource: boolean) => void;
  onClose: () => void;
  /** Set while a forced recompile / the actual export write is in flight -- disables the button, not the checkbox. */
  busy: boolean;
  /** Set if the forced recompile failed; shown in place of the usual footer note. */
  error: string | null;
}

export function ExportDialog({ onExport, onClose, busy, error }: ExportDialogProps) {
  const [includeSource, setIncludeSource] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  return (
    <div
      className="export-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export">
        <div className="export-dialog__header">
          <span className="export-dialog__title">Export</span>
          <button type="button" className="export-dialog__close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        <div className="export-dialog__body">
          <label className="export-dialog__row">
            <input
              type="checkbox"
              checked={includeSource}
              disabled={busy}
              onChange={(event) => setIncludeSource(event.target.checked)}
            />
            <span>Include source files</span>
          </label>
          <p className={"export-dialog__note" + (error ? " export-dialog__note--error" : "")}>
            {error ?? "Compiles fresh before exporting, so the PDF always matches what's on screen now."}
          </p>
          <button type="button" className="export-dialog__export" disabled={busy} onClick={() => onExport(includeSource)}>
            {busy ? "Exporting…" : "Export…"}
          </button>
        </div>
      </div>
    </div>
  );
}
