import { documentStoreContractWith } from "@yomizaka/core/document-store/contract-kit";

import { createDeviceStore, createPhoneStore, DEVICE_PLACE, extensionOf, type FilePort } from "./device-store";

const ID = "11111111-1111-4111-8111-111111111111";

/** An in-memory sandbox: the contract the store keeps, without a phone. */
function memoryFiles() {
  const files = new Map<string, Uint8Array>();
  const port: FilePort = {
    ensureDirectory: () => undefined,
    copy: (from, to) => void files.set(to, files.get(from) ?? new Uint8Array([1])),
    write: (uri, bytes) => void files.set(uri, bytes),
    read: (uri) => files.get(uri) ?? null,
    names: (dir) => [...files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
    remove: (uri) => void files.delete(uri),
  };
  return { files, port };
}

describe("the document store of the device", () => {
  it("keeps a copy named by the document's id, and finds it again", async () => {
    const { port, files } = memoryFiles();
    const store = createDeviceStore(port, "file:///sandbox/");
    expect(store.uriOf(ID)).toBeNull();
    store.keep(ID, "Bail 2026.PDF", "file:///cache/picked.pdf");
    // One file, named by the key and the content type: `documents/<id>.pdf` @ `application/pdf`.
    const uri = `file:///sandbox/store/${encodeURIComponent(`documents/${ID}.pdf`)}@${encodeURIComponent("application/pdf")}`;
    expect(store.uriOf(ID)).toBe(uri);
    expect(files.has(uri)).toBe(true);
  });

  it("forgets a document when it is removed, and a removed document that was never kept is no error", async () => {
    const { port } = memoryFiles();
    const store = createDeviceStore(port, "file:///sandbox");
    store.keep(ID, "a.pdf", "file:///cache/a.pdf");
    await store.remove(ID);
    expect(store.uriOf(ID)).toBeNull();
    await expect(store.remove(ID)).resolves.toBeUndefined();
  });

  it("only takes ids the server knows, never a path", async () => {
    const store = createDeviceStore(memoryFiles().port, "file:///sandbox");
    for (const bad of ["../x", "nope", ""]) {
      expect(() => store.keep(bad, "a.pdf", "file:///a")).toThrow("not a document id");
      expect(() => store.uriOf(bad)).toThrow();
      await expect(store.remove(bad)).rejects.toThrow();
    }
  });

  it("says where the documents live: on the device", () => {
    expect(createDeviceStore(memoryFiles().port, "file:///s").describe()).toBe(DEVICE_PLACE);
    expect(DEVICE_PLACE).toEqual({ kind: "device", owner: "device", residency: "device" });
  });

  it.each([
    ["Bail.PDF", "pdf"],
    ["notes.txt", "txt"],
    ["noext", "bin"],
    ["a.verylongext", "bin"],
  ])("reads the extension of %s as %s", (name, ext) => expect(extensionOf(name)).toBe(ext));
});

// The phone's adapter is a DocumentStore like the web's and the Mac's: it passes the same contract (yomizaka#155, ADR-0007).
describe("the phone's DocumentStore", () => {
  documentStoreContractWith("phone sandbox", () => createPhoneStore(memoryFiles().port, "file:///sandbox"), { it, expect });

  it("says it is the device, keeps nothing outside the sandbox and offers no link", async () => {
    const store = createPhoneStore(memoryFiles().port, "file:///sandbox");
    expect(store.describe()).toMatchObject({ kind: "device", owner: "device", residency: "device", endpoint: null });
    expect(await store.signedUrl("a/b.pdf", 60)).toBeNull();
  });

  it("keeps a picked file under a key without reading it, and finds keys by prefix", () => {
    const { port, files } = memoryFiles();
    const store = createPhoneStore(port, "file:///sandbox");
    files.set("file:///cache/a.pdf", new Uint8Array([7, 7]));
    store.copyIn("documents/a.pdf", "file:///cache/a.pdf", "application/pdf");
    store.copyIn("other/b.pdf", "file:///cache/a.pdf", "application/pdf");
    expect(store.keysWith("documents/")).toEqual(["documents/a.pdf"]);
    expect(store.uriOf("documents/a.pdf")).toMatch(/^file:\/\/\/sandbox\/store\//);
    expect(store.uriOf("documents/none.pdf")).toBeNull();
  });
});
