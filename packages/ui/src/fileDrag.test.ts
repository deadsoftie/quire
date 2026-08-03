import { describe, expect, it } from "vitest";
import { insertionForDraggedFile, toProjectRelativePath } from "./fileDrag";

describe("toProjectRelativePath", () => {
  it("strips the project root and a leading separator", () => {
    expect(toProjectRelativePath("/project/chapters/intro.tex", "/project")).toBe("chapters/intro.tex");
  });

  it("returns the uri unchanged when it isn't under the given root", () => {
    expect(toProjectRelativePath("/elsewhere/file.tex", "/project")).toBe("/elsewhere/file.tex");
  });
});

describe("insertionForDraggedFile", () => {
  it("inserts \\includegraphics for graphic extensions", () => {
    expect(insertionForDraggedFile("figures/plot.png", "")).toBe("\\includegraphics[width=0.8\\linewidth]{figures/plot.png}");
    expect(insertionForDraggedFile("scan.pdf", "")).toBe("\\includegraphics[width=0.8\\linewidth]{scan.pdf}");
  });

  it("inserts \\input for .tex, extension stripped", () => {
    expect(insertionForDraggedFile("chapters/intro.tex", "")).toBe("\\input{chapters/intro}");
  });

  it("inserts \\bibliography for .bib when the document has no bibliography yet", () => {
    expect(insertionForDraggedFile("refs.bib", "\\documentclass{article}")).toBe("\\bibliography{refs}");
  });

  it("falls back to the bare path for .bib when a bibliography is already declared", () => {
    expect(insertionForDraggedFile("refs.bib", "\\bibliography{other}")).toBe("refs.bib");
    expect(insertionForDraggedFile("refs.bib", "\\addbibresource{other.bib}")).toBe("refs.bib");
  });

  it("falls back to the bare relative path for anything else", () => {
    expect(insertionForDraggedFile("data/values.csv", "")).toBe("data/values.csv");
    expect(insertionForDraggedFile("chapters", "")).toBe("chapters");
  });
});
