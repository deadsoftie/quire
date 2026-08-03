import { describe, expect, it } from "vitest";
import type { ExplorerNode } from "@quire/client";
import { extensionOf, flattenVisible, isOpenableFile, parentUriOf } from "./explorerTree";

function file(uri: string, name: string): ExplorerNode {
  return { uri, name, kind: "file", children: null };
}

function dir(uri: string, name: string, children: ExplorerNode[]): ExplorerNode {
  return { uri, name, kind: "directory", children };
}

describe("flattenVisible", () => {
  it("visits every node depth-first when nothing is collapsed", () => {
    const tree = [
      dir("/p/chapters", "chapters", [file("/p/chapters/intro.tex", "intro.tex")]),
      file("/p/main.tex", "main.tex"),
    ];
    const rows = flattenVisible(tree, new Set());
    expect(rows.map((r) => r.node.uri)).toEqual(["/p/chapters", "/p/chapters/intro.tex", "/p/main.tex"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0]);
  });

  it("skips a collapsed directory's children entirely", () => {
    const tree = [
      dir("/p/chapters", "chapters", [file("/p/chapters/intro.tex", "intro.tex")]),
      file("/p/main.tex", "main.tex"),
    ];
    const rows = flattenVisible(tree, new Set(["/p/chapters"]));
    expect(rows.map((r) => r.node.uri)).toEqual(["/p/chapters", "/p/main.tex"]);
  });

  it("still recurses into nested subdirectories that are themselves expanded", () => {
    const tree = [dir("/p/a", "a", [dir("/p/a/b", "b", [file("/p/a/b/c.tex", "c.tex")])])];
    const rows = flattenVisible(tree, new Set());
    expect(rows.map((r) => r.node.uri)).toEqual(["/p/a", "/p/a/b", "/p/a/b/c.tex"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });
});

describe("extensionOf", () => {
  it("lowercases and strips the leading dot", () => {
    expect(extensionOf("Photo.PNG")).toBe("png");
    expect(extensionOf("main.tex")).toBe("tex");
  });

  it("is empty for an extensionless name", () => {
    expect(extensionOf("Makefile")).toBe("");
  });
});

describe("isOpenableFile", () => {
  it("is true for tex/bib/plain-text-shaped files", () => {
    expect(isOpenableFile("main.tex")).toBe(true);
    expect(isOpenableFile("refs.bib")).toBe(true);
    expect(isOpenableFile("notes.md")).toBe(true);
    expect(isOpenableFile("Makefile")).toBe(true);
  });

  it("is false for known binary formats", () => {
    expect(isOpenableFile("figure.png")).toBe(false);
    expect(isOpenableFile("paper.pdf")).toBe(false);
    expect(isOpenableFile("archive.zip")).toBe(false);
  });
});

describe("parentUriOf", () => {
  it("strips the trailing /name to recover the containing directory", () => {
    expect(parentUriOf(file("/p/chapters/intro.tex", "intro.tex"))).toBe("/p/chapters");
    expect(parentUriOf(dir("/p/chapters", "chapters", []))).toBe("/p");
  });
});
