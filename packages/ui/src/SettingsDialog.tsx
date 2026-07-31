import { useEffect } from "react";
import type { DetectSystemTexResponse } from "@quire/client";
import "./SettingsDialog.css";

interface SettingsDialogProps {
  /** `null` while the initial `detectSystemTex()` call is still in flight. */
  systemTexStatus: DetectSystemTexResponse | null;
  useSystemTex: boolean;
  onToggleSystemTex: (value: boolean) => void;
  onClose: () => void;
}

export function SettingsDialog({ systemTexStatus, useSystemTex, onToggleSystemTex, onClose }: SettingsDialogProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const available = systemTexStatus?.available ?? false;

  return (
    <div
      className="settings-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-dialog__header">
          <span className="settings-dialog__title">Settings</span>
          <button type="button" className="settings-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="settings-dialog__body">
          <label className="settings-dialog__row">
            <input
              type="checkbox"
              checked={useSystemTex}
              disabled={!available}
              onChange={(event) => onToggleSystemTex(event.target.checked)}
            />
            <span>Use System TeX for compiling</span>
          </label>
          <p className="settings-dialog__note">
            {systemTexStatus === null
              ? "Checking for a system TeX installation…"
              : available
                ? `Detected: ${systemTexStatus.engine === "xelatex" ? "XeLaTeX" : "pdfLaTeX"} (${systemTexStatus.version})`
                : "No TeX Live or MiKTeX installation was found on your system."}
          </p>
        </div>
      </div>
    </div>
  );
}
