import "./fonts.css";
import "./tokens.css";
import "./primitives.css";

// Mirrors tokens.css for JS consumers that can't read a CSS custom property (e.g. <canvas>); keep in sync by hand.
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
    inkGreen: "#89ca78",
    inkGold: "#e5c07b",
    inkOrange: "#d19a66",
    inkPurple: "#c678dd",
    inkCyan: "#56b6c2",
    inkCyanDim: "#56b6c233",
    inkBrown: "#be9270",
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
    // See tokens.css: darkened to stay >=4.5:1 against light surfaces.
    proofRed: "#dc2920",
    proofAmber: "#966a1d",
    inkGreen: "#4c9a46",
    inkGold: "#a6821f",
    inkOrange: "#a15f1f",
    inkPurple: "#8a3fae",
    inkCyan: "#1b818c",
    inkCyanDim: "#1b818c33",
    inkBrown: "#8a6248",
    paper: "#ffffff",
  },
} as const;

export type ThemeName = keyof typeof palettes;
export type Palette = (typeof palettes)[ThemeName];
