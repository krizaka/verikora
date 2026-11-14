import { describe, expect, it } from "vitest";

import { deleteChoice, libraryPath, movedFolderHrefs, requiredName } from "./rules";

const A = "11111111-1111-4111-8111-111111111111";

describe("names", () => {
  it("are trimmed and collapsed, and never empty or longer than 80 characters", () => {
    expect(requiredName("  Baux   2026 ")).toBe("Baux 2026");
    expect(() => requiredName("   ")).toThrow();
    expect(() => requiredName("x".repeat(81))).toThrow();
  });
});

describe("the path of a library, a collection, a folder", () => {
  it("is the URL of the view", () => {
    expect(libraryPath("fr", "l")).toBe("/fr/app/library/l");
    expect(libraryPath("en", "l", "c")).toBe("/en/app/library/l/c");
    expect(libraryPath("en", "l", "c", "f")).toBe("/en/app/library/l/c/f");
  });
});

describe("what happens to the files of a deleted folder or collection", () => {
  it("must be chosen: move (up, or to a collection) or delete", () => {
    expect(deleteChoice({ files: "delete" })).toEqual({ files: "delete" });
    expect(deleteChoice({ files: "move" })).toEqual({ files: "move", to: null });
    expect(deleteChoice({ files: "move", to: A })).toEqual({ files: "move", to: A });
    expect(() => deleteChoice({})).toThrow();
    expect(() => deleteChoice({ files: "move", to: "nope" })).toThrow();
  });
});

describe("a folder moved from its own page (the UX review's Y7)", () => {
  it("has a new address under each collection whose library is known — none for the others", () => {
    expect(movedFolderHrefs("fr", [{ id: "c2", libraryId: "l1" }, { id: "c3" }], "f1")).toEqual({
      c2: "/fr/app/library/l1/c2/f1",
    });
    expect(movedFolderHrefs("en", [], "f1")).toEqual({});
  });
});
