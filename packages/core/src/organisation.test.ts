import { describe, expect, it } from "vitest";

import {
  applyFilters,
  parseTagsParam,
  parseLibraryView,
  TAG_COLORS,
  tagsHref,
  toggleTag,
  libraryViewHref,
} from "./organisation";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("tag colours are names, mapped to Krizaka tokens by the UI", () => {
  it("lists the allowed colours", () =>
    expect(TAG_COLORS).toEqual(["blue", "green", "amber", "red", "violet", "gray"]));
});

describe("the tags parameter is the filter's state", () => {
  it("reads ids, drops anything that is not an id and duplicates", () => {
    expect(parseTagsParam(`${A},nope,${B},${A}`)).toEqual([A, B]);
    expect(parseTagsParam(undefined)).toEqual([]);
    expect(parseTagsParam([`${A}`, `${B}`])).toEqual([A, B]);
  });
  it("toggles a tag and builds the link that keeps the rest of the path", () => {
    expect(toggleTag([A], B)).toEqual([A, B]);
    expect(toggleTag([A, B], A)).toEqual([B]);
    expect(tagsHref("/fr/app/library/l/c", [A, B])).toBe(`/fr/app/library/l/c?tags=${A},${B}`);
    expect(tagsHref("/fr/app/library/l/c", [])).toBe("/fr/app/library/l/c");
  });
});

describe("the library's filters are the URL's state: ?tags=…&kind=…&status=…", () => {
  it("reads the three, ignoring what is not one of their values", () => {
    expect(parseLibraryView({ tags: `${A}`, kind: "lease", status: "attention" })).toEqual({
      tags: [A],
      kind: "lease",
      status: "attention",
    });
    expect(parseLibraryView({ kind: "spreadsheet", status: "nope" })).toEqual({ tags: [], kind: null, status: null });
    expect(parseLibraryView({})).toEqual({ tags: [], kind: null, status: null });
  });
  it("writes them back in a stable order, keeping the others when one changes", () => {
    const path = "/fr/app/library/l/c";
    expect(libraryViewHref(path, { tags: [], kind: null, status: null })).toBe(path);
    expect(libraryViewHref(path, { tags: [A], kind: "invoice", status: "checked" })).toBe(
      `${path}?tags=${A}&kind=invoice&status=checked`,
    );
    expect(libraryViewHref(path, { tags: [], kind: null, status: "failed" })).toBe(`${path}?status=failed`);
  });
  it("filters documents by kind and by status (all given filters must match)", () => {
    const docs = [
      { id: "1", kind: "lease", status: "attention" },
      { id: "2", kind: "lease", status: "checked" },
      { id: "3", kind: "invoice", status: "attention" },
    ] as const;
    expect(applyFilters(docs, { tags: [], kind: "lease", status: null }).map((d) => d.id)).toEqual(["1", "2"]);
    expect(applyFilters(docs, { tags: [], kind: null, status: "attention" }).map((d) => d.id)).toEqual(["1", "3"]);
    expect(applyFilters(docs, { tags: [], kind: "lease", status: "attention" }).map((d) => d.id)).toEqual(["1"]);
    expect(applyFilters(docs, { tags: [], kind: null, status: null })).toHaveLength(3);
  });
});
