import { documentStoreContract } from "@verikora/core/document-store/contract";
import { describe, expect, it } from "vitest";

import { createMacStore, MAC_STORE_PLACE, type StoreInvoke } from "./mac-store";

/** The Rust side as the page sees it: base64 in and out, errors as « status: message » (store.rs is tested in Rust). */
function fakeNative(): StoreInvoke {
  const files = new Map<string, { data: string; contentType: string }>();
  return async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    const key = String(args.key);
    if (command === "store_put") files.set(key, { data: String(args.data), contentType: String(args.contentType) });
    if (command === "store_get") return (files.get(key) ?? null) as T;
    if (command === "store_delete") files.delete(key);
    return undefined as T;
  };
}

describe("the Mac's DocumentStore", () => {
  documentStoreContract("mac folder", () => createMacStore(fakeNative()));

  it("says the documents live on this Mac", () => {
    expect(createMacStore(fakeNative()).describe()).toEqual(MAC_STORE_PLACE);
  });

  it("turns the native side's « 400: … » into the port's StorageError", async () => {
    const refusing: StoreInvoke = async () => Promise.reject("400: not a valid object key");
    await expect(createMacStore(refusing).get("library/a.pdf")).rejects.toMatchObject({
      status: 400,
      message: "not a valid object key",
    });
    const failing: StoreInvoke = async () => Promise.reject("disk full");
    await expect(createMacStore(failing).delete("library/a.pdf")).rejects.toMatchObject({ status: 500 });
  });
});
