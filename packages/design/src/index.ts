import "./fonts.css";
import "./tokens.css";
import "./primitives.css";

export { builtinThemes, findBuiltinTheme, DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "./themes";
export type { ThemeDefinition, ThemeColors } from "./themes";

import { findBuiltinTheme as findTheme, type ThemeColors } from "./themes";

function toPalette(colors: ThemeColors) {
  return {
    ...colors,
    nonreproDim: `${colors.nonrepro}33`,
    inkCyanDim: `${colors.inkCyan}33`,
    paper: "#ffffff",
  };
}

// Mirrors the two default Quire themes for JS consumers that can't read a CSS custom property
// (e.g. <canvas>). Derived from builtinThemes so there's one source of truth for these colors.
export const palettes = {
  dark: toPalette(findTheme("quire-dark")!.colors),
  light: toPalette(findTheme("quire-light")!.colors),
} as const;

export type ThemeName = keyof typeof palettes;
export type Palette = (typeof palettes)[ThemeName];
