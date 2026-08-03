import { describe, expect, it } from "vitest";
import { categoryLabel, groupByCategory, listCategories, listSnippets, searchSnippets, snippetById } from "./snippetLibrary";

describe("listSnippets", () => {
  it("returns a non-empty, id-unique catalog", () => {
    const snippets = listSnippets();
    expect(snippets.length).toBeGreaterThan(0);
    expect(new Set(snippets.map((s) => s.id)).size).toBe(snippets.length);
  });
});

describe("listCategories", () => {
  it("only returns categories that actually have entries, in a stable declared order", () => {
    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(listSnippets().some((s) => s.category === category)).toBe(true);
    }
  });
});

describe("categoryLabel", () => {
  it("has a human-readable label for every category actually present in the catalog", () => {
    for (const category of listCategories()) {
      expect(categoryLabel(category).length).toBeGreaterThan(0);
    }
  });
});

describe("snippetById", () => {
  it("finds a known entry", () => {
    expect(snippetById("table-booktabs")?.label).toBe("Table (booktabs)");
  });

  it("returns undefined for an unknown id", () => {
    expect(snippetById("does-not-exist")).toBeUndefined();
  });
});

describe("searchSnippets", () => {
  it("returns everything for an empty or whitespace-only query", () => {
    expect(searchSnippets("")).toEqual(listSnippets());
    expect(searchSnippets("   ")).toEqual(listSnippets());
  });

  it("matches case-insensitively against the label", () => {
    const results = searchSnippets("BOOKTABS");
    expect(results.some((s) => s.id === "table-booktabs")).toBe(true);
  });

  it("matches against description text", () => {
    const results = searchSnippets("piecewise");
    expect(results.some((s) => s.id === "cases")).toBe(true);
  });

  it("matches against tags not present in the label or description", () => {
    const results = searchSnippets("pseudocode");
    expect(results.some((s) => s.id === "algorithm")).toBe(true);
  });

  it("returns an empty array for a query matching nothing", () => {
    expect(searchSnippets("xyzzynotarealterm")).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("groups a filtered list, dropping empty categories entirely", () => {
    const groups = groupByCategory(searchSnippets("beamer"));
    expect(groups.length).toBe(1);
    expect(groups[0].category).toBe("beamer");
    expect(groups[0].items.every((s) => s.category === "beamer")).toBe(true);
  });

  it("covers the full catalog when given every snippet", () => {
    const groups = groupByCategory(listSnippets());
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(listSnippets().length);
  });
});
