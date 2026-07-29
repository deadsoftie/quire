import { describe, expect, it } from "vitest";
import { fuzzyScore, rankCommands } from "./fuzzy";
import type { Command } from "./types";

function command(id: string, title: string): Command {
  return { id, title, run: () => {} };
}

describe("fuzzyScore", () => {
  it("rejects targets missing a query character entirely", () => {
    expect(fuzzyScore("xyz", "Open Project")).toBeNull();
  });

  it("rejects out-of-order matches (subsequence, not anagram)", () => {
    // "tcejorP" reversed -- every letter is present, but not in order.
    expect(fuzzyScore("tp", "Open")).toBeNull();
  });

  it("matches a non-contiguous subsequence", () => {
    expect(fuzzyScore("opj", "Open Project")).not.toBeNull();
  });

  it("scores a contiguous substring higher than a scattered match of the same length", () => {
    const contiguous = fuzzyScore("pro", "Open Project")!;
    const scattered = fuzzyScore("pjt", "Open Project")!;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("scores a prefix match higher than the same substring later in the string", () => {
    const prefix = fuzzyScore("open", "Open Project")!;
    const later = fuzzyScore("proj", "Open Project")!;
    expect(prefix).toBeGreaterThan(later);
  });

  it("rewards matches that land on word-boundary letters", () => {
    // "op" as the leading letters of "Open" + "Project" vs. the same two
    // letters occurring mid-word.
    const boundary = fuzzyScore("op", "Open Project")!;
    const midWord = fuzzyScore("op", "Dropdown")!; // matches inside "Dropdown"
    expect(boundary).toBeGreaterThan(midWord);
  });

  it("treats an empty query as matching everything with no preference", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });
});

describe("rankCommands", () => {
  const commands = [
    command("project.open", "Open Project…"),
    command("layout.reset-split", "Reset Editor/Preview Split"),
    command("palette.self-reference", "Command Palette"),
  ];

  it("sorts alphabetically when the query is empty", () => {
    const ranked = rankCommands(commands, "");
    expect(ranked.map((r) => r.command.id)).toEqual([
      "palette.self-reference",
      "project.open",
      "layout.reset-split",
    ]);
  });

  it("excludes commands that don't match at all", () => {
    const ranked = rankCommands(commands, "zzz");
    expect(ranked).toHaveLength(0);
  });

  it("ranks the best match for a query first", () => {
    const ranked = rankCommands(commands, "open proj");
    expect(ranked[0].command.id).toBe("project.open");
  });

  it("ranks an exact prefix match above a same-length scattered match", () => {
    const ranked = rankCommands(commands, "reset");
    expect(ranked[0].command.id).toBe("layout.reset-split");
  });
});
