import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { activeParagraphRange } from "./editorModes";

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
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
