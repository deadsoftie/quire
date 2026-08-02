import { describe, expect, it } from "vitest";
import {
  builtinThemes,
  createThemeId,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  normalizeCustomThemes,
  parsePortableTheme,
  resolveTheme,
  serializePortableTheme,
} from "./theme";
import type { ThemeDefinition } from "./theme";

const CUSTOM: ThemeDefinition = {
  id: "custom-abc",
  name: "My Theme",
  appearance: "dark",
  source: "custom",
  colors: {
    ink900: "#000000",
    ink800: "#111111",
    ink700: "#222222",
    ink600: "#333333",
    typeHi: "#eeeeee",
    typeMid: "#cccccc",
    typeLo: "#999999",
    nonrepro: "#ff00ff",
    proofRed: "#ff0000",
    proofAmber: "#ffaa00",
    inkGreen: "#00ff00",
    inkGold: "#ffff00",
    inkOrange: "#ff8800",
    inkPurple: "#aa00ff",
    inkCyan: "#00ffff",
    inkBrown: "#886644",
  },
};

describe("builtinThemes", () => {
  it("ships exactly 8 themes, 4 dark and 4 light", () => {
    expect(builtinThemes).toHaveLength(8);
    expect(builtinThemes.filter((t) => t.appearance === "dark")).toHaveLength(4);
    expect(builtinThemes.filter((t) => t.appearance === "light")).toHaveLength(4);
  });

  it("has no duplicate ids", () => {
    const ids = builtinThemes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("resolveTheme", () => {
  it("resolves a known built-in id", () => {
    expect(resolveTheme("monokai").name).toBe("Monokai");
  });

  it("falls back to Quire Dark for an unknown id", () => {
    expect(resolveTheme("not-a-real-theme").id).toBe(DEFAULT_DARK_THEME_ID);
  });

  it("resolves the two default ids to their expected appearance", () => {
    expect(resolveTheme(DEFAULT_DARK_THEME_ID).appearance).toBe("dark");
    expect(resolveTheme(DEFAULT_LIGHT_THEME_ID).appearance).toBe("light");
  });

  it("resolves a custom theme id when the custom catalog is passed", () => {
    expect(resolveTheme("custom-abc", [CUSTOM])).toBe(CUSTOM);
  });

  it("falls back to Quire Dark when a custom catalog is passed but doesn't contain the id", () => {
    expect(resolveTheme("custom-xyz", [CUSTOM]).id).toBe(DEFAULT_DARK_THEME_ID);
  });

  it("prefers a built-in match over a same-id custom entry (built-in ids are never user-assignable, but defence in depth)", () => {
    expect(resolveTheme("monokai", [{ ...CUSTOM, id: "monokai" }]).source).toBe("builtin");
  });
});

describe("createThemeId", () => {
  it("produces unique, custom-prefixed ids", () => {
    const a = createThemeId();
    const b = createThemeId();
    expect(a).not.toBe(b);
    expect(a.startsWith("custom-")).toBe(true);
  });
});

describe("normalizeCustomThemes", () => {
  it("keeps a well-formed theme", () => {
    expect(normalizeCustomThemes([CUSTOM])).toEqual([CUSTOM]);
  });

  it("drops non-array input entirely", () => {
    expect(normalizeCustomThemes(null)).toEqual([]);
    expect(normalizeCustomThemes({})).toEqual([]);
  });

  it("drops an entry missing a name", () => {
    const { name: _name, ...withoutName } = CUSTOM;
    expect(normalizeCustomThemes([withoutName])).toEqual([]);
  });

  it("drops an entry with an invalid appearance", () => {
    expect(normalizeCustomThemes([{ ...CUSTOM, appearance: "sepia" }])).toEqual([]);
  });

  it("drops an entry with a malformed hex color", () => {
    expect(normalizeCustomThemes([{ ...CUSTOM, colors: { ...CUSTOM.colors, ink900: "not-a-color" } }])).toEqual([]);
  });

  it("drops an entry missing a color key entirely", () => {
    const { ink900: _ink900, ...restColors } = CUSTOM.colors;
    expect(normalizeCustomThemes([{ ...CUSTOM, colors: restColors }])).toEqual([]);
  });

  it("keeps well-formed entries and drops malformed ones from the same array", () => {
    const bad = { ...CUSTOM, id: "custom-bad", appearance: "sepia" };
    expect(normalizeCustomThemes([CUSTOM, bad])).toEqual([CUSTOM]);
  });
});

describe("serializePortableTheme / parsePortableTheme round-trip", () => {
  it("round-trips name, appearance, and colors, dropping id/source", () => {
    const serialized = serializePortableTheme(CUSTOM);
    expect(serialized).not.toContain("custom-abc");
    expect(parsePortableTheme(serialized)).toEqual({ name: CUSTOM.name, appearance: CUSTOM.appearance, colors: CUSTOM.colors });
  });
});

describe("parsePortableTheme", () => {
  it("rejects invalid JSON", () => {
    expect(parsePortableTheme("not json")).toBeNull();
  });

  it("rejects JSON that isn't an object", () => {
    expect(parsePortableTheme("42")).toBeNull();
    expect(parsePortableTheme("null")).toBeNull();
  });

  it("rejects a missing name", () => {
    const { name: _name, ...rest } = { name: CUSTOM.name, appearance: CUSTOM.appearance, colors: CUSTOM.colors };
    expect(parsePortableTheme(JSON.stringify(rest))).toBeNull();
  });

  it("rejects an invalid appearance", () => {
    expect(parsePortableTheme(JSON.stringify({ name: "X", appearance: "sepia", colors: CUSTOM.colors }))).toBeNull();
  });

  it("rejects a malformed hex color", () => {
    const colors = { ...CUSTOM.colors, ink900: "not-a-color" };
    expect(parsePortableTheme(JSON.stringify({ name: "X", appearance: "dark", colors }))).toBeNull();
  });

  it("rejects a missing color key", () => {
    const { ink900: _ink900, ...restColors } = CUSTOM.colors;
    expect(parsePortableTheme(JSON.stringify({ name: "X", appearance: "dark", colors: restColors }))).toBeNull();
  });
});
