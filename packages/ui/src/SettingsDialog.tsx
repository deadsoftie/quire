import { useEffect } from "react";
import type { DetectSystemTexResponse } from "@quire/client";
import { Toggle } from "./Toggle";
import "./SettingsDialog.css";

interface SettingsDialogProps {
  /** `null` while the initial `detectSystemTex()` call is still in flight. */
  systemTexStatus: DetectSystemTexResponse | null;
  useSystemTex: boolean;
  onToggleSystemTex: (value: boolean) => void;
  focusMode: boolean;
  onToggleFocusMode: (value: boolean) => void;
  typewriterMode: boolean;
  onToggleTypewriterMode: (value: boolean) => void;
  proseMode: boolean;
  onToggleProseMode: (value: boolean) => void;
  wordWrap: boolean;
  onToggleWordWrap: (value: boolean) => void;
  lightTheme: boolean;
  onToggleLightTheme: (value: boolean) => void;
  pdfInverted: boolean;
  onTogglePdfInverted: (value: boolean) => void;
  onClose: () => void;
}

export function SettingsDialog({
  systemTexStatus,
  useSystemTex,
  onToggleSystemTex,
  focusMode,
  onToggleFocusMode,
  typewriterMode,
  onToggleTypewriterMode,
  proseMode,
  onToggleProseMode,
  wordWrap,
  onToggleWordWrap,
  lightTheme,
  onToggleLightTheme,
  pdfInverted,
  onTogglePdfInverted,
  onClose,
}: SettingsDialogProps) {
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
            <Toggle checked={useSystemTex} disabled={!available} onChange={onToggleSystemTex} />
            <span>Use System TeX for compiling</span>
          </label>
          <p className="settings-dialog__note">
            {systemTexStatus === null
              ? "Checking for a system TeX installation…"
              : available
                ? `Detected: ${systemTexStatus.engine === "xelatex" ? "XeLaTeX" : "pdfLaTeX"} (${systemTexStatus.version})`
                : "No TeX Live or MiKTeX installation was found on your system."}
          </p>

          <span className="settings-dialog__section-title">View</span>
          <label className="settings-dialog__row">
            <Toggle checked={focusMode} onChange={onToggleFocusMode} />
            <span>Focus Mode</span>
          </label>
          <label className="settings-dialog__row">
            <Toggle checked={typewriterMode} onChange={onToggleTypewriterMode} />
            <span>Typewriter Scrolling</span>
          </label>
          <label className="settings-dialog__row">
            <Toggle checked={proseMode} onChange={onToggleProseMode} />
            <span>Serif Prose Mode</span>
          </label>
          <label className="settings-dialog__row">
            <Toggle checked={wordWrap} onChange={onToggleWordWrap} />
            <span>Word Wrap</span>
          </label>
          <label className="settings-dialog__row">
            <Toggle checked={lightTheme} onChange={onToggleLightTheme} />
            <span>Light Theme</span>
          </label>
          <label className="settings-dialog__row">
            <Toggle checked={pdfInverted} onChange={onTogglePdfInverted} />
            <span>Invert PDF Colors</span>
          </label>
        </div>
      </div>
    </div>
  );
}
