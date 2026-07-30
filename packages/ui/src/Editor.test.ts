import { describe, expect, it } from "vitest";
import { extensionForMimeType } from "./Editor";

describe("extensionForMimeType", () => {
  it("keeps jpg/jpeg sources as jpg", () => {
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("image/jpg")).toBe("jpg");
  });

  it("defaults everything else to png, matching Chromium's own clipboard normalization", () => {
    expect(extensionForMimeType("image/png")).toBe("png");
    expect(extensionForMimeType("image/gif")).toBe("png");
    expect(extensionForMimeType("image/tiff")).toBe("png");
  });
});
