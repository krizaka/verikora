/**
 * The DocumentStore PORT (ADR-0007), shared by every Verikora app: the application keeps a document through it and never
 * names a vendor. The web chooses its adapter in configuration (apps/web/lib/storage/providers.ts) — nothing kept (the default),
 * Bunny (development and fictional data only), any S3-compatible provider —; the Mac keeps documents in a folder of its own
 * (apps/desktop), the phone in its sandbox. Every adapter passes `documentStoreContract` (`@verikora/core/document-store/contract`).
 */
import type { StoredObject } from "@krizaka/storage";

import type { StorageKind, StorageOwner, StorageResidency } from "./index";

export type { StoredObject };

/** Where a document lives, as the info panel says it (#164). */
export interface DocumentStoreDescriptor {
  kind: StorageKind;
  /** The host the files go to (`tor1.digitaloceanspaces.com`, `s3.example.com`), when there is one. */
  endpoint: string | null;
  region: string | null;
  residency: StorageResidency;
  encrypted: boolean;
  /** Whose storage it is: Krizaka's, the workspace's own cloud (bring your own), or the person's device. */
  owner: StorageOwner;
  /** True when the adapter must never hold real personal data (no Canadian region). */
  devOnly: boolean;
}

export interface DocumentStore {
  put(key: string, bytes: Uint8Array, meta: { contentType: string }): Promise<void>;
  /** The object, or null when there is none. */
  get(key: string): Promise<StoredObject | null>;
  /** A short-lived link the browser can follow, or null when the adapter has none (the app then serves the bytes itself). */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;
  /** Idempotent: deleting what is not there succeeds. */
  delete(key: string): Promise<void>;
  describe(): DocumentStoreDescriptor;
}

export class DocumentStoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,254}$/;
/**
 * An object key: a lowercase name made of letters, digits and `/_.-` — never `..`, an empty segment or a `.` segment, nor a
 * trailing `/`. Nothing escapes the prefix, and no two adapters read one key as two objects (`a/./b.pdf` is one file on a disk
 * and another entry in a map: refused everywhere).
 */
export function assertDocumentKey(key: string): string {
  if (!KEY.test(key) || key.includes("..") || key.includes("//") || key.endsWith("/") || key.split("/").includes("."))
    throw new DocumentStoreError(400, "Not a valid object key");
  return key;
}
