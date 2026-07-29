import { describe, expect, it } from "vitest";
import type { SyntaxNode, Tree } from "@lezer/common";
import { latexLanguage } from "./language";

function parse(source: string): Tree {
  return latexLanguage.parser.parse(source);
}

function nodesOf(tree: Tree, source: string, name: string) {
  const found: { from: number; to: number; text: string }[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === name) {
        found.push({ from: node.from, to: node.to, text: source.slice(node.from, node.to) });
      }
    },
  });
  return found;
}

function hasErrorNodes(tree: Tree) {
  let found = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) found = true;
    },
  });
  return found;
}

function isNestedIn(
  tree: Tree,
  source: string,
  child: { name: string; text: string },
  ancestor: { name: string; text: string },
) {
  let ok = false;
  tree.iterate({
    enter: (outer: SyntaxNode) => {
      if (outer.name !== ancestor.name || source.slice(outer.from, outer.to) !== ancestor.text) return;
      outer.node.toTree().iterate({
        enter: (inner) => {
          if (inner.name === child.name && source.slice(inner.from + outer.from, inner.to + outer.from) === child.text) {
            ok = true;
          }
        },
      });
    },
  });
  return ok;
}

describe("LaTeX grammar", () => {
  it("parses commands and a document environment without errors", () => {
    const source =
      "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";
    const tree = parse(source);
    expect(hasErrorNodes(tree)).toBe(false);

    expect(nodesOf(tree, source, "Command").map((n) => n.text)).toContain("\\documentclass");
    const envs = nodesOf(tree, source, "Environment");
    expect(envs).toHaveLength(1);
    expect(envs[0].text.startsWith("\\begin{document}")).toBe(true);
    expect(envs[0].text.endsWith("\\end{document}")).toBe(true);
    expect(nodesOf(tree, source, "EnvName").map((n) => n.text)).toEqual(["document", "document"]);
  });

  it("treats a bare % as a comment but \\% as an escaped character", () => {
    const source = "100\\% of results, not a comment.\n% But this is a comment\n";
    const tree = parse(source);
    expect(hasErrorNodes(tree)).toBe(false);

    expect(nodesOf(tree, source, "Command").map((n) => n.text)).toEqual(["\\%"]);
    expect(nodesOf(tree, source, "Comment").map((n) => n.text)).toEqual([
      "% But this is a comment",
    ]);
  });

  it("recognizes $...$, $$...$$, and \\[...\\] as math", () => {
    const source = "Inline $a + b$ and display \\[ x^2 + y^2 \\] and $$ E = mc^2 $$.\n";
    const tree = parse(source);
    expect(hasErrorNodes(tree)).toBe(false);

    expect(nodesOf(tree, source, "InlineMath").map((n) => n.text)).toEqual(["$a + b$"]);
    expect(nodesOf(tree, source, "DisplayMathBracket").map((n) => n.text)).toEqual([
      "\\[ x^2 + y^2 \\]",
    ]);
    expect(nodesOf(tree, source, "DisplayMathDollar").map((n) => n.text)).toEqual([
      "$$ E = mc^2 $$",
    ]);
  });

  it("handles math nested via \\text, at $...$ level and inside a math environment", () => {
    const source =
      "$a + \\text{$b$ and more}$\n" +
      "\\begin{align}\nx &= y \\\\\n\\text{where $z > 0$}\n\\end{align}\n";
    const tree = parse(source);
    expect(hasErrorNodes(tree)).toBe(false);

    const outerDollarMath = "$a + \\text{$b$ and more}$";
    expect(nodesOf(tree, source, "InlineMath").map((n) => n.text)).toContain(outerDollarMath);
    expect(
      isNestedIn(tree, source, { name: "InlineMath", text: "$b$" }, { name: "InlineMath", text: outerDollarMath }),
    ).toBe(true);

    const mathEnvs = nodesOf(tree, source, "MathEnvironment");
    expect(mathEnvs).toHaveLength(1);
    expect(nodesOf(tree, source, "MathEnvName").map((n) => n.text)).toEqual(["align", "align"]);
    expect(
      isNestedIn(
        tree,
        source,
        { name: "InlineMath", text: "$z > 0$" },
        { name: "MathEnvironment", text: mathEnvs[0].text },
      ),
    ).toBe(true);
  });

  it("leaves verbatim content unparsed", () => {
    const source =
      "\\begin{verbatim}\n\\no{command}[parsing]$here$ % not a comment\n\\end{verbatim}\n";
    const tree = parse(source);
    expect(hasErrorNodes(tree)).toBe(false);

    const body = nodesOf(tree, source, "VerbatimBody");
    expect(body).toHaveLength(1);
    expect(body[0].text).toBe("\\no{command}[parsing]$here$ % not a comment\n");

    expect(nodesOf(tree, source, "Command")).toHaveLength(0);
    expect(nodesOf(tree, source, "Comment")).toHaveLength(0);
    expect(nodesOf(tree, source, "InlineMath")).toHaveLength(0);
  });
});
