import { describe, expect, it } from "vitest";
import { extensionForMimeType, isTexFile } from "./Editor";

describe("extensionForMimeType", () => {
  it("keeps jpg/jpeg sources as jpg", () => {
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/jpg")).toBe("jpg");
  });

  it("defaults everything else to png, matching Chromium's own clipboard normalization", () => {
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/gif")).toBe("png");
    expect(extensionForMimeType("image/tiff")).toBe("png");
  });
});

describe("isTexFile", () => {
  it("is true for .tex, case-insensitively", () => {
    expect(isTexFile("/project/main.tex")).toBe(true);
    expect(isTexFile("/project/MAIN.TEX")).toBe(true);
  });

  it("is false for other text files and extensionless files", () => {
    expect(isTexFile("/project/refs.bib")).toBe(false);
    expect(isTexFile("/project/notes.md")).toBe(false);
    expect(isTexFile("/project/Makefile")).toBe(false);
  });
});
