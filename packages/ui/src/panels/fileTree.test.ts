import { describe, expect, it } from "vitest";
import type { FileNode } from "@quire/client";
import { buildFileTree } from "./fileTree";

const PROJECT = "/home/user/thesis";

function file(uri: string, kind: FileNode["kind"] = "tex"): FileNode {
  const name = uri.split("/").pop()!;
  return { uri, name, kind };
}

describe("buildFileTree", () => {
  it("nests files under their directory segments", () => {
    const tree = buildFileTree(
      [file(`${PROJECT}/main.tex`), file(`${PROJECT}/chapters/intro.tex`)],
      PROJECT,
    );

    expect(tree.map((n) => n.name)).toEqual(["chapters", "main.tex"]);
    const chapters = tree.find((n) => n.name === "chapters")!;
    expect(chapters.kind).toBe("directory");
    expect(chapters.uri).toBeUndefined();
    expect(chapters.children.map((n) => n.name)).toEqual(["intro.tex"]);
    expect(chapters.children[0].uri).toBe(`${PROJECT}/chapters/intro.tex`);
  });

  it("lists directories before files, alphabetically within each group", () => {
    const tree = buildFileTree(
      [
        file(`${PROJECT}/zeta.tex`),
        file(`${PROJECT}/alpha.tex`),
        file(`${PROJECT}/nested/b.tex`),
        file(`${PROJECT}/nested/a.tex`),
        file(`${PROJECT}/beta_dir/c.tex`),
      ],
      PROJECT,
    );

    expect(tree.map((n) => n.name)).toEqual(["beta_dir", "nested", "alpha.tex", "zeta.tex"]);
    const nested = tree.find((n) => n.name === "nested")!;
    expect(nested.children.map((n) => n.name)).toEqual(["a.tex", "b.tex"]);
  });

  it("merges two files under the same nested directory into one node", () => {
    const tree = buildFileTree(
      [file(`${PROJECT}/chapters/intro.tex`), file(`${PROJECT}/chapters/outro.tex`)],
      PROJECT,
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("chapters");
    expect(tree[0].children.map((n) => n.name)).toEqual(["intro.tex", "outro.tex"]);
  });

  it("preserves the real FileNodeKind (tex vs graphic vs bib) on leaves", () => {
    const tree = buildFileTree(
      [file(`${PROJECT}/figures/plot.pdf`, "graphic"), file(`${PROJECT}/refs.bib`, "bib")],
      PROJECT,
    );

    expect(tree[0].children[0].kind).toBe("graphic");
    expect(tree.find((n) => n.name === "refs.bib")!.kind).toBe("bib");
  });

  it("returns an empty tree for an empty file list", () => {
    expect(buildFileTree([], PROJECT)).toEqual([]);
  });
});
