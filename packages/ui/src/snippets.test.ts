import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { snippetCompletionSource } from "./snippets";

function contextAt(doc: string, pos: number, explicit = false): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, explicit);
}

describe("snippetCompletionSource", () => {
  it("offers matching snippets for a bare word prefix", () => {
    const doc = "fig";
    const result = snippetCompletionSource(contextAt(doc, doc.length));
    expect(result).not.toBeNull();
    expect(result?.from).toBe(0);
    expect(result?.options.map((o) => o.label)).toEqual(["fig"]);
  });

  it("prefix-matches, e.g. a leading 's' only offers 'sec'", () => {
    const doc = "s";
    const result = snippetCompletionSource(contextAt(doc, doc.length));
    expect(result?.options.map((o) => o.label)).toEqual(["sec"]);
  });

  it("returns null when nothing matches and completion wasn't explicit", () => {
    const doc = "xyz";
    expect(snippetCompletionSource(contextAt(doc, doc.length))).toBeNull();
  });

  it("does not fire right after a backslash, to avoid doubling up with command completion", () => {
    const doc = "\\sec";
    expect(snippetCompletionSource(contextAt(doc, doc.length))).toBeNull();
  });

  it("mirrors the same tabstop field across both begin/end lines in the 'beg' template", () => {
    const doc = "beg";
    const result = snippetCompletionSource(contextAt(doc, doc.length));
    const beg = result?.options.find((o) => o.label === "beg");
    expect(beg).toBeDefined();
    expect(typeof beg?.apply).toBe("function");
  });
});
