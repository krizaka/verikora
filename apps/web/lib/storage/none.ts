import type { DocumentStore } from "./port";
import { DocumentStoreError } from "./port";

/** The default: nothing is kept. The document is purged after the check and only the report stays; the user keeps what they choose to keep. */
export function noneStore(): DocumentStore {
  return {
    async put() {
      throw new DocumentStoreError(409, "Keeping documents is switched off");
    },
    async get() {
      return null;
    },
    async signedUrl() {
      return null;
    },
    async delete() {},
    describe: () => ({
      kind: "none",
      endpoint: null,
      region: null,
      residency: "unknown",
      encrypted: false,
      owner: "krizaka",
      devOnly: false,
    }),
  };
}
