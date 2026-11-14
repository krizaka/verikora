import { type CloudOwner, STORAGE_OWNER } from "@verikora/core";

import { defaultStore, providers } from "@/app/storage-providers";
import { query } from "@/lib/db";
import type { HeldObject } from "@/lib/document-objects";
import { env } from "@/lib/env";
import { EXTERNAL } from "@/lib/retention";
import { localStore } from "@/lib/storage/local";
import { noneStore } from "@/lib/storage/none";
import type { DocumentStore, DocumentStoreDescriptor } from "@/lib/storage/port";
import { DATA_KIND } from "@/lib/storage/providers";
import { ownS3Store, type StorageChoice, storeForOwner } from "@/lib/storage/settings";

/** The documents store this deployment configures (Krizaka's): the default provider the admin chose in the database (ADR-005); none = nothing is kept. */
export const krizakaStore = async (): Promise<DocumentStore> =>
  (await defaultStore(DATA_KIND.documents)) ?? noneStore();

export interface OwnerStores {
  /** Where new kept documents go: nothing, Krizaka's store or the owner's own cloud, from their settings. */
  write: DocumentStore;
  settings: StorageChoice;
  /** The store that holds a document of this owner (by who owns that store); null when it is not available. */
  of: (owner: CloudOwner) => DocumentStore | null;
  describe: (owner: CloudOwner) => DocumentStoreDescriptor;
}

/** The stores of an account: its own settings decide where new documents go; each kept document is read from the store that holds it. */
export async function storesOf(ownerId: string): Promise<OwnerStores> {
  const registry = providers();
  const krizaka = await krizakaStore();
  const own = await ownS3Store(query, ownerId, registry);
  const { store: write, settings } = await storeForOwner(query, ownerId, registry, krizaka).catch(() => ({
    store: noneStore(),
    settings: { mode: "none", keepDefault: false, s3: null, testedAt: null } as StorageChoice,
  }));
  const of = (o: CloudOwner) => (o === STORAGE_OWNER.workspace ? own : krizaka);
  return { write, settings, of, describe: (o) => (of(o) ?? noneStore()).describe() };
}

/**
 * The store that holds the bytes of every document that is not kept in a store of its own (ADR-0012): the deployment's store when it
 * configures one, else a folder on disk in development and tests. Production without a real store has none: null (uploads are refused).
 */
export async function workingStore(): Promise<DocumentStore | null> {
  const krizaka = await krizakaStore();
  if (krizaka.describe().kind !== "none") return krizaka;
  return env().APP_ENVIRONMENT === "prod" ? null : localStore();
}

/** The store that holds one document: its owner's cloud or Krizaka's for a kept one, the working store for the rest; undefined when it has none to ask. */
export async function storeForDocument(ownerId: string, documentId: string): Promise<DocumentStore | undefined> {
  const [row] = await query<{ storage: string; storage_owner: CloudOwner }>(
    "SELECT storage, storage_owner FROM documents WHERE owner_id = $1 AND id = $2",
    [ownerId, documentId],
  ).catch(() => []);
  if (row && !EXTERNAL.has(row.storage as never)) return (await workingStore()) ?? undefined;
  const stores = await storesOf(ownerId);
  return stores.of(row?.storage_owner ?? "krizaka") ?? undefined;
}

/** The holder of a stored file, for the purge: the owner's own cloud when it is theirs, else Krizaka's (kept) or the working store (not kept). */
export async function holderOf(row: HeldObject): Promise<DocumentStore | null> {
  if (!EXTERNAL.has(row.storage as never)) return workingStore();
  return (await storesOf(row.owner_id)).of(row.storage_owner as CloudOwner);
}

/** Where uploaded avatars live: the default provider of the avatars (the same one as the documents unless the admin separates them); null when none is set (avatars are then picked from the set only). */
export async function avatarStore(): Promise<DocumentStore | null> {
  try {
    return await defaultStore(DATA_KIND.avatars);
  } catch {
    return null;
  }
}
