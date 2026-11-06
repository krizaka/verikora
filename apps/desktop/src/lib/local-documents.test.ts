import { describe, expect, it } from "vitest";

import { createLocalDocuments, type PathStore } from "./local-documents";

function memory(): PathStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("the files of the Mac the documents came from", () => {
  it("remembers the path of a document, and answers nothing for another", () => {
    const documents = createLocalDocuments(memory());
    documents.remember("d1", "/Users/eric/Baux/bail.pdf");
    expect(documents.pathOf("d1")).toBe("/Users/eric/Baux/bail.pdf");
    expect(documents.pathOf("d2")).toBeNull();
  });

  it("starts again from nothing when what was stored is not readable", () => {
    const store = memory();
    store.setItem("verikora.local-documents", "not json");
    const documents = createLocalDocuments(store);
    expect(documents.pathOf("d1")).toBeNull();
    documents.remember("d1", "/a.pdf");
    expect(documents.pathOf("d1")).toBe("/a.pdf");
  });

  it("keeps working when the storage refuses to write", () => {
    const documents = createLocalDocuments({
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => documents.remember("d1", "/a.pdf")).not.toThrow();
  });
});
