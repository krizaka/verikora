import type { DocumentFileStore } from "./storage/port";

/** A row that may have a file in a store: who owns it, where it lives, under which key (ADR-0012). */
export interface HeldObject {
  owner_id: string;
  storage: string;
  storage_owner: string;
  object_key: string | null;
}

/** Finds the store that holds a document's file (Krizaka's working store, or the owner's own cloud); null when it is not available. */
export type ObjectHolder = (row: HeldObject) => Promise<DocumentFileStore | null>;

/** The holder of callers that give none: no store is available, so a stored file is never purged half way. */
export const noHolder: ObjectHolder = async () => null;

/**
 * Deletes the file of a row from its store. True when nothing is left in a store (no key, or the delete went through); false when the
 * store is not available or did not answer — the caller then keeps the row, and the sweep retries.
 */
export async function removeObject(row: HeldObject, holder: ObjectHolder): Promise<boolean> {
  if (!row.object_key) return true;
  try {
    const store = await holder(row);
    if (!store) return false;
    await store.delete(row.object_key);
    return true;
  } catch {
    return false;
  }
}
