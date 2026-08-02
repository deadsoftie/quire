// `paper` (the PDF surface) is deliberately excluded -- it's fixed white in every theme, never
// themeable (see QUIRE_SPEC.md: "The PDF stays white in both [modes]"). `-Dim` variants
// (nonreproDim, inkCyanDim) aren't stored either; callers derive them as `${hex}33`.
export interface ThemeColors {
  ink900: string;
  ink800: string;
  ink700: string;
  ink600: string;
  typeHi: string;
  typeMid: string;
  typeLo: string;
  nonrepro: string;
  proofRed: string;
  proofAmber: string;
  inkGreen: string;
  inkGold: string;
  inkOrange: string;
  inkPurple: string;
  inkCyan: string;
  inkBrown: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  appearance: "dark" | "light";
  /** Built-in themes are code-owned and read-only in the UI; custom ones come from the user's theme file. */
  source: "builtin" | "custom";
  colors: ThemeColors;
}

function builtin(id: string, name: string, appearance: "dark" | "light", colors: ThemeColors): ThemeDefinition {
  return { id, name, appearance, source: "builtin", colors };
}

export const builtinThemes: ThemeDefinition[] = [
  builtin("quire-dark", "Quire Dark", "dark", {
    ink900: "#16181d",
    ink800: "#1c1f26",
    ink700: "#252932",
    ink600: "#333944",
    typeHi: "#e8eaed",
    typeMid: "#9ba3b0",
    typeLo: "#626b79",
    nonrepro: "#8fc7e8",
    proofRed: "#e5534b",
    proofAmber: "#d9a03c",
    inkGreen: "#89ca78",
    inkGold: "#e5c07b",
    inkOrange: "#d19a66",
    inkPurple: "#c678dd",
    inkCyan: "#56b6c2",
    inkBrown: "#be9270",
  }),
  builtin("monokai", "Monokai", "dark", {
    ink900: "#272822",
    ink800: "#2d2e27",
    ink700: "#3e3d32",
    ink600: "#49483e",
    typeHi: "#f8f8f2",
    typeMid: "#c2c2bc",
    typeLo: "#90887a",
    nonrepro: "#66d9ef",
    proofRed: "#f92672",
    proofAmber: "#fd971f",
    inkGreen: "#a6e22e",
    inkGold: "#e6db74",
    inkOrange: "#fd971f",
    inkPurple: "#ae81ff",
    inkCyan: "#66d9ef",
    inkBrown: "#b3a488",
  }),
  builtin("dracula", "Dracula", "dark", {
    ink900: "#282a36",
    ink800: "#2f3241",
    ink700: "#383a4a",
    ink600: "#44475a",
    typeHi: "#f8f8f2",
    typeMid: "#bfc2d1",
    typeLo: "#6272a4",
    nonrepro: "#ff79c6",
    proofRed: "#ff5555",
    proofAmber: "#ffb86c",
    inkGreen: "#50fa7b",
    inkGold: "#f1fa8c",
    inkOrange: "#ffb86c",
    inkPurple: "#bd93f9",
    inkCyan: "#8be9fd",
    inkBrown: "#d69f80",
  }),
  builtin("gruvbox-dark", "Gruvbox Dark", "dark", {
    ink900: "#282828",
    ink800: "#32302f",
    ink700: "#3c3836",
    ink600: "#504945",
    typeHi: "#ebdbb2",
    typeMid: "#d5c4a1",
    typeLo: "#a89984",
    nonrepro: "#fe8019",
    proofRed: "#fb4934",
    proofAmber: "#fabd2f",
    inkGreen: "#b8bb26",
    inkGold: "#fabd2f",
    // Gruvbox's own orange is already the accent (nonrepro) -- borrows its blue here so
    // section headings stay visually distinct from `\textbf`/`\foo` commands.
    inkOrange: "#83a598",
    inkPurple: "#d3869b",
    inkCyan: "#8ec07c",
    inkBrown: "#af3a03",
  }),
  builtin("quire-light", "Quire Light", "light", {
    ink900: "#f7f8fa",
    ink800: "#f0f2f5",
    ink700: "#e6e9ee",
    ink600: "#dde1e7",
    typeHi: "#14161b",
    typeMid: "#4b5563",
    typeLo: "#7a828f",
    nonrepro: "#8fc7e8",
    proofRed: "#dc2920",
    proofAmber: "#966a1d",
    inkGreen: "#4c9a46",
    inkGold: "#a6821f",
    inkOrange: "#a15f1f",
    inkPurple: "#8a3fae",
    inkCyan: "#1b818c",
    inkBrown: "#8a6248",
  }),
  builtin("gruvbox-light", "Gruvbox Light", "light", {
    ink900: "#fbf1c7",
    ink800: "#f2e5bc",
    ink700: "#ebdbb2",
    ink600: "#d5c4a1",
    typeHi: "#3c3836",
    typeMid: "#504945",
    typeLo: "#7c6f64",
    nonrepro: "#af3a03",
    proofRed: "#9d0006",
    proofAmber: "#b57614",
    inkGreen: "#79740e",
    inkGold: "#b57614",
    // Same reasoning as gruvbox-dark: borrows Gruvbox's blue instead of colliding with the accent orange.
    inkOrange: "#076678",
    inkPurple: "#8f3f71",
    inkCyan: "#427b58",
    inkBrown: "#9d6c3c",
  }),
  builtin("solarized-light", "Solarized Light", "light", {
    ink900: "#fdf6e3",
    ink800: "#f5efdc",
    ink700: "#eee8d5",
    ink600: "#e3ddc8",
    typeHi: "#073642",
    typeMid: "#586e75",
    typeLo: "#93a1a1",
    nonrepro: "#268bd2",
    proofRed: "#dc322f",
    proofAmber: "#b58900",
    inkGreen: "#859900",
    inkGold: "#b58900",
    inkOrange: "#cb4b16",
    inkPurple: "#6c71c4",
    inkCyan: "#2aa198",
    inkBrown: "#a67c52",
  }),
  builtin("github-light", "GitHub Light", "light", {
    ink900: "#ffffff",
    ink800: "#f6f8fa",
    ink700: "#eaeef2",
    ink600: "#d0d7de",
    typeHi: "#1f2328",
    typeMid: "#59636e",
    typeLo: "#8c959f",
    nonrepro: "#0969da",
    proofRed: "#cf222e",
    proofAmber: "#9a6700",
    inkGreen: "#116329",
    inkGold: "#9a6700",
    inkOrange: "#953800",
    inkPurple: "#8250df",
    inkCyan: "#1b7c83",
    inkBrown: "#7d4e00",
  }),
];

export const DEFAULT_DARK_THEME_ID = "quire-dark";
export const DEFAULT_LIGHT_THEME_ID = "quire-light";

export function findBuiltinTheme(id: string): ThemeDefinition | undefined {
  return builtinThemes.find((t) => t.id === id);
}
