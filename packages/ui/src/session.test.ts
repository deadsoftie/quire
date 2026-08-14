import { describe, expect, it } from "vitest";
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@quire/design";
import { normalizeSession, type SessionState } from "./session";

const FALLBACK: SessionState = {
  projectPath: null,
  openTabs: [],
  activeUri: null,
  targetRoot: null,
  sidebarSection: "file-tree",
  sidebarWidth: 240,
  splitFraction: 0.5,
  focusMode: false,
  typewriterMode: false,
  proseMode: false,
  wordWrap: false,
  themeId: DEFAULT_DARK_THEME_ID,
  pdfInverted: false,
  useSystemTex: false,
  cursor: null,
  scrollTop: null,
};

describe("normalizeSession theme migration", () => {
  it("keeps a themeId that names a real built-in theme", () => {
    expect(normalizeSession({ themeId: "monokai" }, FALLBACK).themeId).toBe("monokai");
  });

  it("maps a pre-multi-theme session's theme: \"dark\" to the default dark theme id", () => {
    expect(normalizeSession({ theme: "dark" }, FALLBACK).themeId).toBe(DEFAULT_DARK_THEME_ID);
  });

  it("maps a pre-multi-theme session's theme: \"light\" to the default light theme id", () => {
    expect(normalizeSession({ theme: "light" }, FALLBACK).themeId).toBe(DEFAULT_LIGHT_THEME_ID);
  });

  it("keeps a themeId even if it doesn't (yet) resolve to a known theme - custom themes load from a separate file that may not have finished loading, so resolution is deferred to resolveTheme()", () => {
    expect(normalizeSession({ themeId: "custom-not-loaded-yet" }, FALLBACK).themeId).toBe("custom-not-loaded-yet");
  });

  it("falls back when themeId is an empty string and there's no legacy theme field either", () => {
    expect(normalizeSession({ themeId: "" }, FALLBACK).themeId).toBe(FALLBACK.themeId);
  });

  it("falls back on completely missing/malformed session data", () => {
    expect(normalizeSession(null, FALLBACK).themeId).toBe(FALLBACK.themeId);
    expect(normalizeSession({}, FALLBACK).themeId).toBe(FALLBACK.themeId);
  });
});

describe("normalizeSession targetRoot", () => {
  it("keeps a saved target uri", () => {
    expect(normalizeSession({ targetRoot: "/p/chapters/intro.tex" }, FALLBACK).targetRoot).toBe("/p/chapters/intro.tex");
  });

  it("falls back to null when absent, same as activeUri's own handling - not pre-validated here", () => {
    expect(normalizeSession({}, FALLBACK).targetRoot).toBeNull();
  });
});
