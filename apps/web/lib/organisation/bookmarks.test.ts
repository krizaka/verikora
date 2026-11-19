import { describe, expect, it } from "vitest";

import { dividers, knownBookmarks, wearingAll, withBookmark, withInherited } from "./bookmarks";

const by = { d1: [{ id: "a" }, { id: "b" }], d2: [{ id: "a" }], d3: [] };

describe("documents filtered by bookmark", () => {
  it("keeps every document when no bookmark is asked for", () => {
    expect(wearingAll(["d1", "d2", "d3"], by, [])).toEqual(["d1", "d2", "d3"]);
  });
  it("keeps the documents that wear the bookmark", () => {
    expect(wearingAll(["d1", "d2", "d3"], by, ["a"])).toEqual(["d1", "d2"]);
  });
  it("asks for all of several bookmarks, not any", () => {
    expect(wearingAll(["d1", "d2", "d3"], by, ["a", "b"])).toEqual(["d1"]);
  });
  it("treats a document with no entry as wearing none", () => {
    expect(wearingAll(["d9"], by, ["a"])).toEqual([]);
  });
  it("keeps the order of the ids it is given", () => {
    expect(wearingAll(["d2", "d1"], by, ["a"])).toEqual(["d2", "d1"]);
  });
});

describe("the bookmarks an address may name", () => {
  it("drops an id the person does not have", () => {
    expect(knownBookmarks(["a", "gone"], [{ id: "a" }, { id: "b" }])).toEqual(["a"]);
  });
});

describe("one tap on a row", () => {
  it("applies a bookmark once and lifts only that one", () => {
    expect(withBookmark(["a"], "b", true)).toEqual(["a", "b"]);
    expect(withBookmark(["a", "b"], "b", true)).toEqual(["a", "b"]);
    expect(withBookmark(["a", "b"], "a", false)).toEqual(["b"]);
    expect(withBookmark([], "a", false)).toEqual([]);
  });
});

describe("the bookmarks as binder dividers", () => {
  const marks = [
    { id: "a", name: "Urgent", color: "red" as const },
    { id: "b", name: "Verified", color: "green" as const },
  ];
  const input = { bookmarks: marks, ids: ["d1", "d2", "d3"], tagsByDocument: by, path: "/en/app/documents" };
  it("starts with « All » and counts the documents that wear each bookmark", () => {
    const tabs = dividers({ ...input, selected: [] });
    expect(tabs.map((t) => [t.name, t.count, t.on])).toEqual([
      [null, 3, true],
      ["Urgent", 2, false],
      ["Verified", 1, false],
    ]);
  });
  it("opens a bookmark alone through the address, and marks the one in force", () => {
    const tabs = dividers({ ...input, selected: ["b"] });
    expect(tabs.map((t) => t.href)).toEqual([
      "/en/app/documents",
      "/en/app/documents?tags=a",
      "/en/app/documents?tags=b",
    ]);
    expect(tabs.map((t) => t.on)).toEqual([false, false, true]);
  });
  it("marks no tab when several bookmarks are combined", () => {
    expect(dividers({ ...input, selected: ["a", "b"] }).some((t) => t.on)).toBe(false);
  });
  it("gives a tone with the colour, never the colour alone", () => {
    expect(dividers({ ...input, selected: [] }).map((t) => t.hue)).toEqual(["accent", "danger", "success"]);
  });
});

describe("the bookmarks a document inherits from its collection and folder", () => {
  const own = { d1: [{ id: "a" }], d2: [], d3: [{ id: "r" }] };
  const place = {
    d1: { collectionId: "c1", folderId: null },
    d2: { collectionId: "c1", folderId: "f1" },
    d3: { collectionId: "c2", folderId: null },
  };
  const onPlace = { c1: [{ id: "r" }], f1: [{ id: "f" }] };
  it("adds the tags of the collection and of the folder to the document's own", () => {
    const all = withInherited(own, place, onPlace);
    expect(all.d1.map((t) => t.id)).toEqual(["a", "r"]);
    expect(all.d2.map((t) => t.id)).toEqual(["r", "f"]);
  });
  it("never lists a tag twice, so a count is not doubled", () => {
    expect(withInherited({ d1: [{ id: "r" }] }, { d1: place.d1 }, onPlace).d1.map((t) => t.id)).toEqual(["r"]);
  });
  it("makes a document of a tagged collection match the filter, once", () => {
    const all = withInherited(own, place, onPlace);
    expect(wearingAll(["d1", "d2", "d3"], all, ["r"])).toEqual(["d1", "d2", "d3"]);
  });
  it("leaves a document with no place as it is", () => {
    expect(withInherited({ d9: [{ id: "a" }] }, {}, onPlace).d9).toEqual([{ id: "a" }]);
  });
});
