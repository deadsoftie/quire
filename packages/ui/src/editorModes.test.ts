import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { latexLanguage } from "./latex/language";
import { activeParagraphRange, mathHighlightSpans } from "./editorModes";

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
}

// mathHighlightSpans reads the parsed syntax tree, so (unlike activeParagraphRange, which is
// purely line-based) its test state needs the real LaTeX language attached.
function stateWithLatex(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [latexLanguage] });
}

describe("activeParagraphRange", () => {
  it("spans the whole doc when there are no blank lines", () => {
    const doc = "line one\nline two\nline three";
    const { from, to } = activeParagraphRange(stateAt(doc, 3));
    expect(doc.slice(from, to)).toBe(doc);
  });

  it("stops at a blank line on both sides", () => {
    const doc = "para one\n\npara two line a\npara two line b\n\npara three";
    const pos = doc.indexOf("para two line a") + 3;
    const { from, to } = activeParagraphRange(stateAt(doc, pos));
    expect(doc.slice(from, to)).toBe("para two line a\npara two line b");
  });

  it("treats a single line surrounded by blank lines as its own paragraph", () => {
    const doc = "before\n\nonly line\n\nafter";
    const pos = doc.indexOf("only line");
    const { from, to } = activeParagraphRange(stateAt(doc, pos));
    expect(doc.slice(from, to)).toBe("only line");
  });

  it("treats a whitespace-only line as blank", () => {
    const doc = "para one\n   \npara two";
    const pos = doc.indexOf("para two");
    const { from, to } = activeParagraphRange(stateAt(doc, pos));
    expect(doc.slice(from, to)).toBe("para two");
  });

  it("includes the cursor's own line even at the very start or end of the doc", () => {
    const doc = "only paragraph";
    const { from, to } = activeParagraphRange(stateAt(doc, 0));
    expect(doc.slice(from, to)).toBe(doc);
  });
});

describe("mathHighlightSpans", () => {
  it("finds all four inline/display math forms", () => {
    const doc = "Inline $a+b$ and display \\[ x^2 \\] and $$ y $$ and \\( z \\).";
    const spans = mathHighlightSpans(stateWithLatex(doc));
    expect(spans.map((s) => doc.slice(s.from, s.to))).toEqual(["$a+b$", "\\[ x^2 \\]", "$$ y $$", "\\( z \\)"]);
  });

  it("finds a math environment's whole span", () => {
    const doc = "\\begin{align}\nx &= y\n\\end{align}";
    const spans = mathHighlightSpans(stateWithLatex(doc));
    expect(spans).toHaveLength(1);
    expect(doc.slice(spans[0].from, spans[0].to)).toBe(doc);
  });

  it("produces no spans for plain prose", () => {
    const doc = "Just ordinary text, no math here.";
    expect(mathHighlightSpans(stateWithLatex(doc))).toEqual([]);
  });

  it("only looks within the given from/to range -- the real plugin's own viewport-scoping", () => {
    const doc = "$a$ middle text here $b$";
    const state = stateWithLatex(doc);
    const secondDollarStart = doc.lastIndexOf("$b$");
    // Bounded to just the second math span: the first must not appear.
    const spans = mathHighlightSpans(state, secondDollarStart, doc.length);
    expect(spans.map((s) => doc.slice(s.from, s.to))).toEqual(["$b$"]);
  });
});
