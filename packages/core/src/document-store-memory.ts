import { assertDocumentKey, type DocumentStore, type StoredObject } from "./document-store";

/** An in-memory store: the reference behaviour every adapter's contract test is written against, and a test double. */
export function memoryStore(
  descriptor: Partial<ReturnType<DocumentStore["describe"]>> = {},
): DocumentStore & { size(): number } {
  const objects = new Map<string, StoredObject>();
  return {
    async put(key, bytes, meta) {
      objects.set(assertDocumentKey(key), { bytes: new Uint8Array(bytes), contentType: meta.contentType });
    },
    async get(key) {
      const found = objects.get(assertDocumentKey(key));
      return found ? { bytes: new Uint8Array(found.bytes), contentType: found.contentType } : null;
    },
    async signedUrl() {
      return null;
    },
    async delete(key) {
      objects.delete(assertDocumentKey(key));
    },
    describe: () => ({
      kind: "device",
      endpoint: null,
      region: null,
      residency: "device",
      encrypted: false,
      owner: "device",
      devOnly: false,
      ...descriptor,
    }),
    size: () => objects.size,
  };
}
