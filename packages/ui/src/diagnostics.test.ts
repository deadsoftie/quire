import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import type { Diagnostic } from "@quire/client";
import { toEditorDiagnostics } from "./diagnostics";

function docFor(text: string) {
  return EditorState.create({ doc: text }).doc;
}

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return {
    uri: "/project/main.tex",
    range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    severity: "error",
    message: "Something went wrong",
    rawMessage: "! Something went wrong.",
    ...overrides,
  };
}

describe("toEditorDiagnostics", () => {
  it("converts a point location into a zero-width offset (CM6's own point-marker rendering)", () => {
    const doc = docFor("\\begin{document}\nHello world\n\\end{document}\n");
    const d = diagnostic({ range: { start: { line: 1, column: 3 }, end: { line: 1, column: 3 } } });

    const [result] = toEditorDiagnostics([d], doc);

    const line = doc.line(2);
    expect(result.from).toBe(line.from + 3);
    expect(result.to).toBe(result.from);
    expect(result.severity).toBe("error");
    expect(result.message).toBe("Something went wrong");
  });

  it("honors a real end position when it's past the start", () => {
    const doc = docFor("0123456789\n");
    const d = diagnostic({ range: { start: { line: 0, column: 2 }, end: { line: 0, column: 5 } } });

    const [result] = toEditorDiagnostics([d], doc);
    expect(result.from).toBe(2);
    expect(result.to).toBe(5);
  });

  it("drops diagnostics with no range at all", () => {
    const doc = docFor("x\n");
    const d = diagnostic({ range: null });
    expect(toEditorDiagnostics([d], doc)).toEqual([]);
  });

  it("clamps a stale line/column past the current document instead of throwing", () => {
    const doc = docFor("one line only\n");
    const d = diagnostic({ range: { start: { line: 50, column: 0 }, end: { line: 50, column: 0 } } });
    expect(() => toEditorDiagnostics([d], doc)).not.toThrow();
    expect(toEditorDiagnostics([d], doc)).toEqual([]);
  });

  it("attaches a renderMessage when a hint is present", () => {
    // Not invoked here -- it calls document.createElement, and this suite runs without a DOM
    // (see symbolPreview.ts for the same call).
    const doc = docFor("x\n");
    const d = diagnostic({ hint: "Try this instead" });
    const [result] = toEditorDiagnostics([d], doc);
    expect(result.renderMessage).toBeTypeOf("function");
  });

  it("has no renderMessage when there's no hint", () => {
    const doc = docFor("x\n");
    const d = diagnostic({ hint: undefined });
    const [result] = toEditorDiagnostics([d], doc);
    expect(result.renderMessage).toBeUndefined();
  });
});
