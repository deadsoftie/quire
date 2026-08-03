import { useEffect, useState } from "react";
import "./ExportDialog.css";

interface ExportDialogProps {
  onExport: (includeSource: boolean) => void;
  onClose: () => void;
  /** Set while a forced recompile / the actual export write is in flight -- disables the button, not the checkbox. */
  busy: boolean;
  /** Set if the forced recompile failed; shown in place of the usual footer note. */
  error: string | null;
  /** The real current root (whichever file the last compile actually used) -- `null` before any compile has run yet. */
  rootUri: string | null;
  /** Every `.tex` file in the project, for the root picker. */
  texFiles: { uri: string; label: string }[];
  /** `null` clears an explicit target, returning to automatic root detection. */
  onSelectRoot: (uri: string | null) => void;
}

export function ExportDialog({ onExport, onClose, busy, error, rootUri, texFiles, onSelectRoot }: ExportDialogProps) {
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
          <label className="export-dialog__field">
            <span className="export-dialog__field-label">Root document</span>
            <select
              className="export-dialog__select"
              // Falls back to the "Automatic" option if rootUri doesn't match any known .tex file --
              // can't happen in practice once retargeting's own fallback-on-stale-target logic is in
              // place, but a <select> with no matching option would otherwise silently select nothing.
              value={texFiles.some((f) => f.uri === rootUri) ? (rootUri ?? "") : ""}
              disabled={busy}
              onChange={(event) => onSelectRoot(event.target.value || null)}
            >
              <option value="">Automatic (detected)</option>
              {texFiles.map((f) => (
                <option key={f.uri} value={f.uri}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
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
