import { useEffect } from "react";
import type { ReactNode } from "react";
import type { DetectSystemTexResponse } from "@quire/client";
import { Pencil, Plus, X } from "lucide-react";
import { Toggle } from "./Toggle";
import { builtinThemes } from "./theme";
import type { ThemeDefinition } from "./theme";
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
  themeId: string;
  onSelectTheme: (id: string) => void;
  customThemes: ThemeDefinition[];
  /** Opens the theme editor seeded from the currently active theme, saving as a brand-new custom theme. */
  onRequestNewTheme: () => void;
  /** Opens the theme editor seeded from `theme` -- edits in place if it's already custom, otherwise duplicates it into a new one. */
  onRequestEditTheme: (theme: ThemeDefinition) => void;
  onDeleteTheme: (id: string) => void;
  /** True while the theme editor is open on top of this dialog -- suppresses our own Escape handler so one press closes only the editor, not both. */
  themeEditorOpen: boolean;
  pdfInverted: boolean;
  onTogglePdfInverted: (value: boolean) => void;
  onClose: () => void;
}

const DARK_THEMES = builtinThemes.filter((t) => t.appearance === "dark");
const LIGHT_THEMES = builtinThemes.filter((t) => t.appearance === "light");

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
  themeId,
  onSelectTheme,
  customThemes,
  onRequestNewTheme,
  onRequestEditTheme,
  onDeleteTheme,
  themeEditorOpen,
  pdfInverted,
  onTogglePdfInverted,
  onClose,
}: SettingsDialogProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !themeEditorOpen) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, themeEditorOpen]);

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
            <Toggle checked={pdfInverted} onChange={onTogglePdfInverted} />
            <span>Invert PDF Colors</span>
          </label>

          <span className="settings-dialog__section-title">Theme</span>
          <ThemeGroup
            label="Dark"
            themes={DARK_THEMES}
            activeId={themeId}
            onSelect={onSelectTheme}
            onEdit={onRequestEditTheme}
            onDelete={onDeleteTheme}
          />
          <ThemeGroup
            label="Light"
            themes={LIGHT_THEMES}
            activeId={themeId}
            onSelect={onSelectTheme}
            onEdit={onRequestEditTheme}
            onDelete={onDeleteTheme}
          />
          <ThemeGroup
            label="Your Themes"
            themes={customThemes}
            activeId={themeId}
            onSelect={onSelectTheme}
            onEdit={onRequestEditTheme}
            onDelete={onDeleteTheme}
            emptyHint="No custom themes yet."
            trailing={
              <button
                type="button"
                className="settings-dialog__theme-swatch settings-dialog__theme-swatch--new"
                onClick={onRequestNewTheme}
                title="New Theme"
              >
                <span className="settings-dialog__theme-preview settings-dialog__theme-preview--new">
                  <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="settings-dialog__theme-name">New</span>
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}

function ThemeGroup({
  label,
  themes,
  activeId,
  onSelect,
  onEdit,
  onDelete,
  emptyHint,
  trailing,
}: {
  label: string;
  themes: ThemeDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  onEdit: (theme: ThemeDefinition) => void;
  onDelete: (id: string) => void;
  emptyHint?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="settings-dialog__theme-group">
      <span className="settings-dialog__theme-group-label">{label}</span>
      {themes.length === 0 && emptyHint && <p className="settings-dialog__note">{emptyHint}</p>}
      <div className="settings-dialog__theme-grid">
        {themes.map((theme) => (
          <ThemeSwatch
            key={theme.id}
            theme={theme}
            active={theme.id === activeId}
            onSelect={() => onSelect(theme.id)}
            onEdit={() => onEdit(theme)}
            onDelete={() => onDelete(theme.id)}
          />
        ))}
        {trailing}
      </div>
    </div>
  );
}

function ThemeSwatch({
  theme,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  theme: ThemeDefinition;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors } = theme;
  return (
    <div className="settings-dialog__theme-swatch-wrap">
      <button
        type="button"
        className={"settings-dialog__theme-swatch" + (active ? " settings-dialog__theme-swatch--active" : "")}
        onClick={onSelect}
        aria-pressed={active}
        title={theme.name}
      >
        <span className="settings-dialog__theme-preview" style={{ backgroundColor: colors.ink900, borderColor: colors.ink600 }}>
          <span className="settings-dialog__theme-preview-dot" style={{ backgroundColor: colors.nonrepro }} />
          <span className="settings-dialog__theme-preview-dot" style={{ backgroundColor: colors.inkGreen }} />
          <span className="settings-dialog__theme-preview-dot" style={{ backgroundColor: colors.inkOrange }} />
        </span>
        <span className="settings-dialog__theme-name">{theme.name}</span>
      </button>
      <div className="settings-dialog__theme-actions">
        <button
          type="button"
          className="settings-dialog__theme-action"
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          aria-label={theme.source === "custom" ? `Edit ${theme.name}` : `Duplicate ${theme.name}`}
          title={theme.source === "custom" ? "Edit" : "Duplicate & Edit"}
        >
          <Pencil size={11} strokeWidth={2} aria-hidden="true" />
        </button>
        {theme.source === "custom" && (
          <button
            type="button"
            className="settings-dialog__theme-action"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${theme.name}`}
            title="Delete"
          >
            <X size={11} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
