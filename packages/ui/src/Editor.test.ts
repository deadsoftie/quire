import { describe, expect, it } from "vitest";
import { extensionForMimeType, isTexFile, preambleFix } from "./Editor";
import { snippetById } from "./snippetLibrary";

function entry(id: string) {
  const found = snippetById(id);
  if (!found) throw new Error(`missing fixture snippet ${id}`);
  return found;
}

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

describe("preambleFix", () => {
  const doc = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";

  it("returns null for a snippet with no requiresPackage", () => {
    expect(preambleFix(doc, entry("cite"))).toBeNull();
  });

  it("adds a missing \\usepackage line right before \\begin{document}", () => {
    const fix = preambleFix(doc, entry("tikz-basic"));
    expect(fix).not.toBeNull();
    expect(fix!.insert).toBe("\\usepackage{tikz}\n");
    expect(fix!.from).toBe(doc.indexOf("\\begin{document}"));
    expect(fix!.from).toBe(fix!.to);
  });

  it("is a no-op when the bare package is already loaded", () => {
    const loaded = "\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\end{document}\n";
    expect(preambleFix(loaded, entry("tikz-basic"))).toBeNull();
  });

  it("recognizes a package loaded with options", () => {
    const loaded = "\\documentclass{article}\n\\usepackage[some,options]{tikz}\n\\begin{document}\n\\end{document}\n";
    expect(preambleFix(loaded, entry("tikz-basic"))).toBeNull();
  });

  it("recognizes a package listed among several in one \\usepackage call", () => {
    const loaded = "\\documentclass{article}\n\\usepackage{amsmath,tikz,xcolor}\n\\begin{document}\n\\end{document}\n";
    expect(preambleFix(loaded, entry("tikz-basic"))).toBeNull();
  });

  it("adds both \\usepackage{amsthm} and the \\newtheorem declaration for a bare document", () => {
    const fix = preambleFix(doc, entry("theorem"));
    expect(fix!.insert).toBe("\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n");
  });

  it("only adds the missing half when amsthm is loaded but \\newtheorem isn't declared", () => {
    const loaded = "\\documentclass{article}\n\\usepackage{amsthm}\n\\begin{document}\n\\end{document}\n";
    const fix = preambleFix(loaded, entry("theorem"));
    expect(fix!.insert).toBe("\\newtheorem{theorem}{Theorem}\n");
  });

  it("is a no-op when both the package and the \\newtheorem declaration are already present", () => {
    const loaded =
      "\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\begin{document}\n\\end{document}\n";
    expect(preambleFix(loaded, entry("theorem"))).toBeNull();
  });

  it("switches \\documentclass to beamer for a beamer entry, preserving class options", () => {
    const article = "\\documentclass[11pt]{article}\n\\begin{document}\n\\end{document}\n";
    const fix = preambleFix(article, entry("beamer-frame"));
    expect(fix!.insert).toBe("\\documentclass[11pt]{beamer}");
    expect(article.slice(fix!.from, fix!.to)).toBe("\\documentclass[11pt]{article}");
  });

  it("is a no-op when the document is already a beamer document", () => {
    const beamer = "\\documentclass{beamer}\n\\begin{document}\n\\end{document}\n";
    expect(preambleFix(beamer, entry("beamer-frame"))).toBeNull();
  });
});
