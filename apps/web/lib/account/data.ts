import type { CloudOwner, StorageKind } from "@verikora/core";
import type { QueryResultRow } from "pg";

import { type ObjectHolder, removeObject } from "../document-objects";
import { refuse } from "../http";
import { accountSubject, privacyFor, purposesOf } from "../privacy";
import { EXTERNAL, objectKey } from "../retention";
import { holderFrom, type StoresOf } from "./export";

export { type DataExport, exportData, type StoresOf } from "./export";

type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

/**
 * Erases an account (Loi 25): refuses while a subscription is active (cancel it in the portal first), deletes the kept files from their
 * store, then `@krizaka/privacy` erases every module in one transaction (the person leaves the audit trail, the rows stay without name,
 * address or detail; the identity and what cascades from it go), withdraws the consents and records the request.
 */
export async function eraseAccount(
  deps: { query: Query; stores: StoresOf; holder?: ObjectHolder },
  accountId: string,
): Promise<void> {
  const { query: q } = deps;
  const [a] = await q<{ plan: string; subscription_status: string | null }>(
    "SELECT plan, subscription_status FROM accounts WHERE id = $1",
    [accountId],
  );
  if (!a) throw refuse(404, "NOT_FOUND", "No such account");
  if (a.plan === "PRO" && (a.subscription_status === "active" || a.subscription_status === "trialing"))
    throw refuse(409, "CANCEL_SUBSCRIPTION_FIRST", "Cancel the subscription first");
  const kept = await q<{
    id: string;
    mime_type: string;
    storage: StorageKind;
    storage_owner: CloudOwner;
    object_key: string | null;
  }>("SELECT id, mime_type, storage, storage_owner, object_key FROM documents WHERE owner_id = $1", [accountId]);
  for (const d of kept) {
    // A file in the store (ADR-0012) is deleted whoever holds it; a store that does not answer stops the erasure before any row goes.
    if (d.object_key) {
      if (
        !(await removeObject(
          { owner_id: accountId, storage: d.storage, storage_owner: d.storage_owner, object_key: d.object_key },
          deps.holder ?? holderFrom(deps.stores),
        ))
      )
        throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds a document is not available");
      continue;
    }
    if (!EXTERNAL.has(d.storage)) continue;
    const store = deps.stores(d.storage_owner);
    if (!store || store.describe().kind !== d.storage)
      throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds a document is not available");
    await store.delete(objectKey(accountId, d.id, d.mime_type));
  }
  // every module erases what it holds, then the identity goes, in ONE transaction; the consents are withdrawn and the request recorded (no one named)
  await privacyFor({ stores: deps.stores, purposes: await purposesOf(accountId) }).eraseSubject(
    accountSubject(accountId),
  );
}
