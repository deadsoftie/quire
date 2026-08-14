import { useEffect, useState } from "react";
import type { ThemeColors, ThemeDefinition } from "./theme";
import { createThemeId, parsePortableTheme, serializePortableTheme } from "./theme";
import "./ThemeEditorDialog.css";

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

interface ThemeEditorDialogProps {
  /** Theme the editor is seeded from - a built-in or another custom theme when creating new, or the theme itself when editing in place. */
  base: ThemeDefinition;
  /** Set when editing an existing custom theme in place (Save overwrites it); `null` when duplicating into a brand-new custom theme. */
  editingId: string | null;
  onSave: (theme: ThemeDefinition) => void;
  onCancel: () => void;
  /** Called on every draft change so the app reflects the edit live; App.tsx reverts to the real active theme on cancel. */
  onPreview: (theme: ThemeDefinition) => void;
}

interface ColorField {
  key: keyof ThemeColors;
  label: string;
}

const SURFACE_FIELDS: ColorField[] = [
  { key: "ink900", label: "Editor Background" },
  { key: "ink800", label: "Panel Background" },
  { key: "ink700", label: "Raised Surface" },
  { key: "ink600", label: "Border" },
];

const TEXT_FIELDS: ColorField[] = [
  { key: "typeHi", label: "Primary Text" },
  { key: "typeMid", label: "Secondary Text" },
  { key: "typeLo", label: "Muted Text" },
];

const ACCENT_FIELDS: ColorField[] = [
  { key: "nonrepro", label: "Accent" },
  { key: "proofRed", label: "Error" },
  { key: "proofAmber", label: "Warning" },
];

const SYNTAX_FIELDS: ColorField[] = [
  { key: "inkGreen", label: "Comment" },
  { key: "inkGold", label: "Keyword / Environment" },
  { key: "inkOrange", label: "Heading" },
  { key: "inkPurple", label: "Reference / Link" },
  { key: "inkCyan", label: "Math" },
  { key: "inkBrown", label: "Verbatim" },
];

export function ThemeEditorDialog({ base, editingId, onSave, onCancel, onPreview }: ThemeEditorDialogProps) {
  const [name, setName] = useState(editingId ? base.name : `${base.name} Copy`);
  const [appearance, setAppearance] = useState(base.appearance);
  const [colors, setColors] = useState(base.colors);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    onPreview({ id: editingId ?? "preview", name, appearance, source: "custom", colors });
    // Live preview only - onPreview (applyTheme) is a stable module-level function, not app state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearance, colors]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function setColor(key: keyof ThemeColors, value: string) {
    setColors((c) => ({ ...c, [key]: value }));
  }

  const trimmedName = name.trim();

  function handleSave() {
    if (!trimmedName) return;
    onSave({ id: editingId ?? createThemeId(), name: trimmedName, appearance, source: "custom", colors });
  }

  async function handleExport() {
    const content = serializePortableTheme({ name: trimmedName || name, appearance, colors });
    await window.quireDesktop.exportTheme(slugify(trimmedName || name), content);
  }

  async function handleImport() {
    const raw = await window.quireDesktop.importTheme();
    if (raw === null) return; // cancelled - not an error, say nothing
    const portable = parsePortableTheme(raw);
    if (!portable) {
      setImportError("That file isn't a valid Quire theme.");
      return;
    }
    setImportError(null);
    setName(portable.name);
    setAppearance(portable.appearance);
    setColors(portable.colors);
  }

  return (
    <div
      className="theme-editor-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="theme-editor-dialog" role="dialog" aria-modal="true" aria-label="Theme Editor">
        <div className="theme-editor-dialog__header">
          <span className="theme-editor-dialog__title">{editingId ? "Edit Theme" : "New Theme"}</span>
          <button type="button" className="theme-editor-dialog__close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <div className="theme-editor-dialog__body">
          <label className="theme-editor-dialog__name-row">
            <span className="theme-editor-dialog__section-title">Name</span>
            <input
              type="text"
              className="theme-editor-dialog__name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <div className="theme-editor-dialog__appearance-row">
            <span className="theme-editor-dialog__section-title">Appearance</span>
            <div className="theme-editor-dialog__appearance-options">
              <label className="theme-editor-dialog__appearance-option">
                <input type="radio" checked={appearance === "dark"} onChange={() => setAppearance("dark")} />
                <span>Dark</span>
              </label>
              <label className="theme-editor-dialog__appearance-option">
                <input type="radio" checked={appearance === "light"} onChange={() => setAppearance("light")} />
                <span>Light</span>
              </label>
            </div>
          </div>

          <ColorFieldGroup title="Surfaces" fields={SURFACE_FIELDS} colors={colors} onChange={setColor} />
          <ColorFieldGroup title="Text" fields={TEXT_FIELDS} colors={colors} onChange={setColor} />
          <ColorFieldGroup title="Accent & Status" fields={ACCENT_FIELDS} colors={colors} onChange={setColor} />
          <ColorFieldGroup title="Syntax" fields={SYNTAX_FIELDS} colors={colors} onChange={setColor} />

          {importError && <p className="theme-editor-dialog__error">{importError}</p>}
        </div>
        <div className="theme-editor-dialog__footer">
          <div className="theme-editor-dialog__footer-group">
            <button type="button" className="theme-editor-dialog__cancel" onClick={handleImport}>
              Import…
            </button>
            <button type="button" className="theme-editor-dialog__cancel" onClick={handleExport}>
              Export…
            </button>
          </div>
          <div className="theme-editor-dialog__footer-group">
            <button type="button" className="theme-editor-dialog__cancel" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="theme-editor-dialog__save" disabled={!trimmedName} onClick={handleSave}>
              Save Theme
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorFieldGroup({
  title,
  fields,
  colors,
  onChange,
}: {
  title: string;
  fields: ColorField[];
  colors: ThemeColors;
  onChange: (key: keyof ThemeColors, value: string) => void;
}) {
  return (
    <div className="theme-editor-dialog__group">
      <span className="theme-editor-dialog__section-title">{title}</span>
      {fields.map(({ key, label }) => (
        <ColorRow key={key} label={label} value={colors[key]} onChange={(value) => onChange(key, value)} />
      ))}
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  function commitIfValid(next: string) {
    setText(next);
    if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next);
  }

  return (
    <div className="theme-editor-dialog__color-row">
      <span className="theme-editor-dialog__color-label">{label}</span>
      <input type="color" className="theme-editor-dialog__color-swatch" value={value} onChange={(event) => onChange(event.target.value)} />
      <input
        type="text"
        className="theme-editor-dialog__color-hex"
        value={text}
        onChange={(event) => commitIfValid(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
