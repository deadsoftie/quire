import { builtinThemes, findBuiltinTheme, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@quire/design";
import type { ThemeDefinition, ThemeColors } from "@quire/design";

export type { ThemeDefinition, ThemeColors };
export { builtinThemes, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID };

// Order mirrors ThemeColors; reused by both normalizeCustomThemes' validation and applyTheme below.
const COLOR_KEYS: (keyof ThemeColors)[] = [
  "ink900",
  "ink800",
  "ink700",
  "ink600",
  "typeHi",
  "typeMid",
  "typeLo",
  "nonrepro",
  "proofRed",
  "proofAmber",
  "inkGreen",
  "inkGold",
  "inkOrange",
  "inkPurple",
  "inkCyan",
  "inkBrown",
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function resolveTheme(themeId: string, customThemes: ThemeDefinition[] = []): ThemeDefinition {
  return (
    findBuiltinTheme(themeId) ?? customThemes.find((t) => t.id === themeId) ?? findBuiltinTheme(DEFAULT_DARK_THEME_ID)!
  );
}

export function allThemes(customThemes: ThemeDefinition[]): ThemeDefinition[] {
  return [...builtinThemes, ...customThemes];
}

export function createThemeId(): string {
  return `custom-${crypto.randomUUID()}`;
}

/** `null` if `raw` isn't an object or is missing/misformats any of the 16 color keys. */
function parseColors(raw: unknown): ThemeColors | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rawColors = raw as Record<string, unknown>;
  const colors = {} as ThemeColors;
  for (const key of COLOR_KEYS) {
    const value = rawColors[key];
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return null;
    colors[key] = value;
  }
  return colors;
}

/** Rejects malformed entries individually rather than the whole file -- same defensive posture as session.ts's normalizeSession. */
export function normalizeCustomThemes(raw: unknown): ThemeDefinition[] {
  if (!Array.isArray(raw)) return [];
  const result: ThemeDefinition[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0) continue;
    if (typeof e.name !== "string" || e.name.length === 0) continue;
    if (e.appearance !== "dark" && e.appearance !== "light") continue;
    const colors = parseColors(e.colors);
    if (!colors) continue;
    result.push({ id: e.id, name: e.name, appearance: e.appearance, source: "custom", colors });
  }
  return result;
}

/** The editor's working draft, shared between the "New"/"Edit" flow and file import/export -- no
 * `id`/`source` since those are assigned locally on Save regardless of where the colors came from. */
export interface PortableTheme {
  name: string;
  appearance: "dark" | "light";
  colors: ThemeColors;
}

export function serializePortableTheme(theme: PortableTheme): string {
  const portable: PortableTheme = { name: theme.name, appearance: theme.appearance, colors: theme.colors };
  return JSON.stringify(portable, null, 2);
}

/** `null` if `raw` isn't valid JSON, or is missing/misformats any required field. */
export function parsePortableTheme(raw: string): PortableTheme | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.name !== "string" || p.name.length === 0) return null;
  if (p.appearance !== "dark" && p.appearance !== "light") return null;
  const colors = parseColors(p.colors);
  if (!colors) return null;
  return { name: p.name, appearance: p.appearance, colors };
}

// Token order mirrors tokens.css so a diff between the two is easy to eyeball.
export function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  const { colors } = theme;
  root.style.setProperty("--ink-900", colors.ink900);
  root.style.setProperty("--ink-800", colors.ink800);
  root.style.setProperty("--ink-700", colors.ink700);
  root.style.setProperty("--ink-600", colors.ink600);
  root.style.setProperty("--type-hi", colors.typeHi);
  root.style.setProperty("--type-mid", colors.typeMid);
  root.style.setProperty("--type-lo", colors.typeLo);
  root.style.setProperty("--nonrepro", colors.nonrepro);
  root.style.setProperty("--nonrepro-dim", `${colors.nonrepro}33`);
  root.style.setProperty("--proof-red", colors.proofRed);
  root.style.setProperty("--proof-amber", colors.proofAmber);
  root.style.setProperty("--ink-green", colors.inkGreen);
  root.style.setProperty("--ink-gold", colors.inkGold);
  root.style.setProperty("--ink-orange", colors.inkOrange);
  root.style.setProperty("--ink-purple", colors.inkPurple);
  root.style.setProperty("--ink-cyan", colors.inkCyan);
  root.style.setProperty("--ink-cyan-dim", `${colors.inkCyan}33`);
  root.style.setProperty("--ink-brown", colors.inkBrown);
  root.dataset.theme = theme.appearance;
}
