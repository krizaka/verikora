import { tmpdir } from "node:os";
import { join } from "node:path";

import { folderStore } from "@krizaka/storage";

import { documentStoreOver } from "./adapter";
import type { DocumentStore } from "./port";

/** Where a laptop or a test keeps the bytes of documents when the deployment configures no store (development only: production refuses to start uploads without a real one, ADR-0012). */
export const defaultLocalDir = () => join(tmpdir(), "verikora-documents");

/**
 * The local store: a folder on disk behind the same port. It is not a place to keep documents (`kind` stays `none`, nothing is promised
 * to the person): it holds the bytes of a document until its purge, so that PostgreSQL never does (ADR-0012).
 */
export function localStore(dir: string = defaultLocalDir()): DocumentStore {
  return documentStoreOver(
    folderStore({ root: dir }),
    {
      kind: "none",
      endpoint: null,
      region: null,
      residency: "unknown",
      encrypted: false,
      owner: "krizaka",
      devOnly: true,
    },
    900,
  );
}
