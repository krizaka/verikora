import { type ObjectStore, STORAGE_CODE, StorageError as PackageError } from "@krizaka/storage";

import type { DocumentStore, DocumentStoreDescriptor } from "./port";
import { assertDocumentKey, DocumentStoreError } from "./port";

/**
 * Verikora's DocumentStore (`@verikora/core`, shared with the Mac and the phone) over a `@krizaka/storage` ObjectStore: the same
 * keys, put/get/delete/signedUrl one for one. What the package refuses (a provider that answers an error) becomes the 502 the routes
 * already answer; the descriptor is the one the product says (where it is, whose it is), computed from the configuration. A signed link never outlives `maxTtlSeconds`, whatever a caller asks.
 */
export function documentStoreOver(
  objects: ObjectStore,
  descriptor: DocumentStoreDescriptor,
  maxTtlSeconds: number,
): DocumentStore {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PackageError && error.code === STORAGE_CODE.unreadable)
        throw new DocumentStoreError(500, "The stored object failed its integrity check");
      if (error instanceof PackageError)
        throw new DocumentStoreError(502, `Storage refused the request (${error.code})`);
      throw error;
    }
  };
  return {
    put: (key, bytes, meta) => guard(() => objects.put(assertDocumentKey(key), bytes, meta)),
    get: (key) => guard(() => objects.get(assertDocumentKey(key))),
    signedUrl: (key, ttlSeconds) =>
      guard(() => objects.signedUrl(assertDocumentKey(key), Math.min(ttlSeconds, maxTtlSeconds))),
    delete: (key) => guard(() => objects.delete(assertDocumentKey(key))),
    describe: () => descriptor,
  };
}
