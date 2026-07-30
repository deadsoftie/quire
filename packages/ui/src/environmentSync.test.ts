import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { latex } from "./latex/language";
import { environmentSync } from "./environmentSync";

function stateWith(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [latex(), environmentSync()] });
}

describe("environmentSync", () => {
  it("mirrors a full rename from \\begin{} into \\end{}", () => {
    const state = stateWith("\\begin{document}\nHello\n\\end{document}\n");
    const from = state.doc.toString().indexOf("document");
    const tr = state.update({ changes: { from, to: from + "document".length, insert: "article" } });
    expect(tr.state.doc.toString()).toBe("\\begin{article}\nHello\n\\end{article}\n");
  });

  it("mirrors a single-character insertion typed into \\end{} back into \\begin{}", () => {
    const state = stateWith("\\begin{fig}\nx\n\\end{fig}\n");
    const endName = state.doc.toString().lastIndexOf("fig");
    const tr = state.update({ changes: { from: endName + 3, to: endName + 3, insert: "ure" } });
    expect(tr.state.doc.toString()).toBe("\\begin{figure}\nx\n\\end{figure}\n");
  });

  it("mirrors a deletion (backspace-style shrink)", () => {
    const state = stateWith("\\begin{figure}\nx\n\\end{figure}\n");
    const beginName = state.doc.toString().indexOf("figure");
    // Delete the trailing "ure" from the begin name.
    const tr = state.update({ changes: { from: beginName + 3, to: beginName + 6, insert: "" } });
    expect(tr.state.doc.toString()).toBe("\\begin{fig}\nx\n\\end{fig}\n");
  });

  it("mirrors math environment names (MathEnvName)", () => {
    const state = stateWith("\\begin{align}\nx &= y\n\\end{align}\n");
    const from = state.doc.toString().indexOf("align");
    const tr = state.update({ changes: { from, to: from + "align".length, insert: "gather" } });
    expect(tr.state.doc.toString()).toBe("\\begin{gather}\nx &= y\n\\end{gather}\n");
  });

  it("mirrors verbatim environment names (VerbatimEnvName)", () => {
    const state = stateWith("\\begin{verbatim}\nraw $stuff$\n\\end{verbatim}\n");
    const from = state.doc.toString().indexOf("verbatim");
    const tr = state.update({ changes: { from, to: from + "verbatim".length, insert: "lstlisting" } });
    expect(tr.state.doc.toString()).toBe("\\begin{lstlisting}\nraw $stuff$\n\\end{lstlisting}\n");
  });

  it("only mirrors the innermost pair when environments nest", () => {
    const state = stateWith("\\begin{outer}\n\\begin{inner}\nx\n\\end{inner}\n\\end{outer}\n");
    const from = state.doc.toString().indexOf("inner");
    const tr = state.update({ changes: { from, to: from + "inner".length, insert: "center" } });
    expect(tr.state.doc.toString()).toBe(
      "\\begin{outer}\n\\begin{center}\nx\n\\end{center}\n\\end{outer}\n",
    );
  });

  it("does not mirror edits to ordinary document content", () => {
    const state = stateWith("\\begin{document}\nHello\n\\end{document}\n");
    const from = state.doc.toString().indexOf("Hello");
    const tr = state.update({ changes: { from, to: from + "Hello".length, insert: "Goodbye" } });
    expect(tr.state.doc.toString()).toBe("\\begin{document}\nGoodbye\n\\end{document}\n");
  });

  it("does not add a redundant no-op change when the edit already matches the sibling", () => {
    const state = stateWith("\\begin{document}\nHello\n\\end{document}\n");
    const from = state.doc.toString().indexOf("document");
    // Replace "document" with the exact same text -- both names are already in sync.
    const tr = state.update({ changes: { from, to: from + "document".length, insert: "document" } });
    let changeCount = 0;
    tr.changes.iterChangedRanges(() => changeCount++);
    expect(changeCount).toBe(1);
  });

  it("leaves a pre-existing \\begin{foo}/\\end{bar} mismatch alone until one side is actually edited", () => {
    const state = stateWith("\\begin{foo}\nx\n\\end{bar}\n");
    const from = state.doc.toString().indexOf("x");
    const tr = state.update({ changes: { from, to: from + 1, insert: "y" } });
    expect(tr.state.doc.toString()).toBe("\\begin{foo}\ny\n\\end{bar}\n");
  });

  it("mirrors an insertion typed at the very start of the name (prepend boundary)", () => {
    const state = stateWith("\\begin{ig}\nx\n\\end{ig}\n");
    const beginName = state.doc.toString().indexOf("ig");
    const tr = state.update({ changes: { from: beginName, to: beginName, insert: "f" } });
    expect(tr.state.doc.toString()).toBe("\\begin{fig}\nx\n\\end{fig}\n");
  });

  it("mirrors an insertion typed at the very end of the name (append boundary)", () => {
    const state = stateWith("\\begin{fig}\nx\n\\end{fig}\n");
    const beginName = state.doc.toString().indexOf("fig");
    const tr = state.update({ changes: { from: beginName + 3, to: beginName + 3, insert: "ure" } });
    expect(tr.state.doc.toString()).toBe("\\begin{figure}\nx\n\\end{figure}\n");
  });

  it("keeps the mirrored edit in the same transaction, and preserves the userEvent annotation", () => {
    const state = stateWith("\\begin{document}\nHello\n\\end{document}\n");
    const from = state.doc.toString().indexOf("document");
    const tr = state.update({
      changes: { from, to: from + "document".length, insert: "article" },
      userEvent: "input.type",
    });
    expect(tr.isUserEvent("input.type")).toBe(true);
    expect(tr.annotation(Transaction.userEvent)).toBe("input.type");
  });
});
