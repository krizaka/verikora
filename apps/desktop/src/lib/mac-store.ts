import {
  assertDocumentKey,
  type DocumentStore,
  DocumentStoreError,
  type DocumentStoreDescriptor,
} from "@verikora/core";

import { base64Of, bytesOf } from "./desktop";

/** The Rust side of the store (src-tauri/src/store.rs), as `invoke` reaches it. */
export type StoreInvoke = <T>(
  command: "store_put" | "store_get" | "store_delete",
  args: Record<string, unknown>,
) => Promise<T>;

/** Where the Mac's store lives, as the info panel says it: on this device, nowhere else. */
export const MAC_STORE_PLACE: DocumentStoreDescriptor = {
  kind: "device",
  endpoint: null,
  region: null,
  residency: "device",
  encrypted: false,
  owner: "device",
  devOnly: false,
};

/** An error of the Rust side starts with its status (`400: not a valid object key`): the port's DocumentStoreError. */
const asStorageError = (error: unknown): never => {
  const text = String(error);
  const status = Number(/^(\d{3}):/.exec(text)?.[1] ?? 500);
  throw new DocumentStoreError(status, text.replace(/^\d{3}:\s*/, ""));
};

/**
 * The Mac's DocumentStore (ADR-0007, verikora#154): the documents Verikora keeps for the person on this Mac, in the app's own
 * folder. Keys are checked here (the port's rule) and again in Rust, which also refuses a link planted in the folder.
 */
export function createMacStore(invoke: StoreInvoke): DocumentStore {
  return {
    async put(key, bytes, meta) {
      await invoke("store_put", {
        key: assertDocumentKey(key),
        data: base64Of(bytes),
        contentType: meta.contentType,
      }).catch(asStorageError);
    },
    async get(key) {
      const found = await invoke<{ data: string; contentType: string } | null>("store_get", {
        key: assertDocumentKey(key),
      }).catch(asStorageError);
      return found ? { bytes: bytesOf(found.data), contentType: found.contentType } : null;
    },
    // The bytes are on this Mac: the page shows them itself, there is no link to sign.
    signedUrl: async () => null,
    async delete(key) {
      await invoke("store_delete", { key: assertDocumentKey(key) }).catch(asStorageError);
    },
    describe: () => MAC_STORE_PLACE,
  };
}
