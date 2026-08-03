import { describe, expect, it } from "vitest";
import { rewriteTabUris } from "./tabUriRewrite";

describe("rewriteTabUris", () => {
  it("rewrites an exact match and reports it as the new active uri", () => {
    const result = rewriteTabUris([{ uri: "/p/old.tex" }], "/p/old.tex", "/p/new.tex", "/p/old.tex");
    expect(result.tabs).toEqual([{ uri: "/p/new.tex" }]);
    expect(result.nextActiveUri).toBe("/p/new.tex");
  });

  it("rewrites tabs nested under a renamed directory, preserving the rest of the path", () => {
    const tabs = [{ uri: "/p/chapters/intro.tex" }, { uri: "/p/chapters/sub/deep.tex" }];
    const result = rewriteTabUris(tabs, "/p/chapters", "/p/parts", null);
    expect(result.tabs).toEqual([{ uri: "/p/parts/intro.tex" }, { uri: "/p/parts/sub/deep.tex" }]);
  });

  it("leaves unrelated tabs untouched", () => {
    const tabs = [{ uri: "/p/other.tex" }];
    const result = rewriteTabUris(tabs, "/p/old.tex", "/p/new.tex", null);
    expect(result.tabs).toEqual([{ uri: "/p/other.tex" }]);
  });

  it("does not false-positive-match a sibling with a shared prefix", () => {
    // "/p/chapter" must not match "/p/chapters/intro.tex" -- the "/" boundary check is load-bearing.
    const tabs = [{ uri: "/p/chapters/intro.tex" }];
    const result = rewriteTabUris(tabs, "/p/chapter", "/p/renamed", null);
    expect(result.tabs).toEqual([{ uri: "/p/chapters/intro.tex" }]);
  });

  it("reports null nextActiveUri when the active tab wasn't affected", () => {
    const tabs = [{ uri: "/p/old.tex" }, { uri: "/p/active.tex" }];
    const result = rewriteTabUris(tabs, "/p/old.tex", "/p/new.tex", "/p/active.tex");
    expect(result.nextActiveUri).toBeNull();
  });
});
