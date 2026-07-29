import "./fonts.css";
import "./tokens.css";
import "./primitives.css";

// Mirrors tokens.css's color values for the rare JS-side consumer that
// can't just read a CSS custom property (e.g. a <canvas> drawing call).
// Keep these in sync with tokens.css by hand -- there are only two
// palettes and they change rarely.
export const palettes = {
  dark: {
    ink900: "#16181d",
    ink800: "#1c1f26",
    ink700: "#252932",
    ink600: "#333944",
    typeHi: "#e8eaed",
    typeMid: "#9ba3b0",
    typeLo: "#626b79",
    nonrepro: "#8fc7e8",
    nonreproDim: "#8fc7e833",
    proofRed: "#e5534b",
    proofAmber: "#d9a03c",
    paper: "#ffffff",
  },
  light: {
    ink900: "#f7f8fa",
    ink800: "#f0f2f5",
    ink700: "#e6e9ee",
    ink600: "#dde1e7",
    typeHi: "#14161b",
    typeMid: "#4b5563",
    typeLo: "#7a828f",
    nonrepro: "#8fc7e8",
    nonreproDim: "#8fc7e833",
    // Darkened from dark mode's #e5534b/#d9a03c to stay >=4.5:1 against
    // light surfaces -- see tokens.css for the full explanation.
    proofRed: "#dc2920",
    proofAmber: "#966a1d",
    paper: "#ffffff",
  },
} as const;

export type ThemeName = keyof typeof palettes;
export type Palette = (typeof palettes)[ThemeName];
