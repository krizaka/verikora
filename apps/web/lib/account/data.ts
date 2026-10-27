import type { AccountService } from "@krizaka/auth";
import type { CloudOwner, StorageKind } from "@yomizaka/core";
import type { QueryResultRow } from "pg";

import { ledgerState } from "../billing";
import { refuse } from "../http";
import { EXTERNAL, objectKey } from "../retention";
import type { DocumentStore } from "../storage/port";

/** The store that holds a document: Krizaka's configured one, or the owner's own cloud. */
export type StoresOf = (owner: CloudOwner) => DocumentStore | null;

/**
 * What belongs to Yomizaka and not to the account port: exporting a person's data and erasing it (Loi 25: access and
 * erasure). The port deletes the identity; this module first takes the product's own data out of every place it lives.
 */
type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

export interface DataExport {
  exportedAt: string;
  profile: { id: string; email: string; name: string | null; locale: string; perspective: string | null; createdAt: string; termsAcceptedAt: string | null; privacyAcceptedAt: string | null };
  billing: { plan: string; auditCredits: number; freeAuditUsed: boolean; subscriptionStatus: string | null; currentPeriodEnd: string | null };
  libraries: { id: string; name: string; collections: { id: string; name: string; isDefault: boolean; tags: string[]; folders: { id: string; name: string; tags: string[] }[] }[] }[];
  tags: { id: string; name: string; color: string }[];
  documents: {
    id: string;
    title: string;
    filename: string;
    mimeType: string;
    kind: string;
    sizeBytes: number;
    sha256: string;
    pages: number | null;
    createdAt: string;
    storage: string;
    retainUntil: string | null;
    collectionId: string | null;
    folderId: string | null;
    tags: string[];
    text: string | null;
    /** The kept file, base64 — null when the document is not kept (only its report stays). */
    file: { contentType: string; base64: string } | null;
    analyses: { id: string; studio: string; status: string; runId: string | null; createdAt: string; report: unknown }[];
  }[];
  consents: unknown[];
}

/** Everything the person has with Yomizaka, as one JSON document: their profile, organisation, documents (kept files included) and reports. */
export async function exportData(q: Query, accountId: string, stores: StoresOf, now: Date): Promise<DataExport> {
  const [a] = await q<{ id: string; email: string; name: string | null; locale: string; perspective: string | null; created_at: Date; terms_accepted_at: Date | null; privacy_accepted_at: Date | null; plan: string; subscription_status: string | null; current_period_end: Date | null }>(
    "SELECT id, email, name, locale, perspective, created_at, terms_accepted_at, privacy_accepted_at, plan, subscription_status, current_period_end FROM accounts WHERE id = $1",
    [accountId],
  );
  if (!a) throw refuse(404, "NOT_FOUND", "No such account");
  const ledger = await ledgerState(q, accountId, now);
  const libs = await q<{ id: string; name: string }>("SELECT id, name FROM libraries WHERE owner_id = $1 ORDER BY created_at", [accountId]);
  const cols = await q<{ id: string; library_id: string; name: string; is_default: boolean }>("SELECT c.id, c.library_id, c.name, c.is_default FROM collections c WHERE c.owner_id = $1 ORDER BY c.name", [accountId]);
  const folders = await q<{ id: string; collection_id: string; name: string }>("SELECT f.id, f.collection_id, f.name FROM folders f JOIN collections c ON c.id = f.collection_id JOIN libraries l ON l.id = c.library_id WHERE l.owner_id = $1 ORDER BY f.name", [accountId]);
  const tags = await q<{ id: string; name: string; color: string }>("SELECT id, name, color FROM tags WHERE owner_id = $1 ORDER BY lower(name)", [accountId]);
  const tagged = async (table: string, column: string) => {
    const rows = await q<{ target: string; tag: string }>(`SELECT x.${column} AS target, t.name AS tag FROM ${table} x JOIN tags t ON t.id = x.tag_id WHERE t.owner_id = $1`, [accountId]);
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.target, [...(map.get(r.target) ?? []), r.tag]);
    return map;
  };
  const [colTags, folderTags] = await Promise.all([tagged("collections_tags", "collection_id"), tagged("folder_tags", "folder_id")]);
  // The documents' tags are the workspace's (yomizaka#324): the account's own tags of kind « document », worn through the layer's join table.
  const docTagRows = await q<{ target: string; tag: string }>("SELECT w.entity_id AS target, t.name AS tag FROM organize.document_tag w JOIN organize.tag t ON t.id = w.tag_id WHERE t.scope_id = $1 AND t.kind = 'document'", [accountId]);
  const docTags = new Map<string, string[]>();
  for (const r of docTagRows) docTags.set(r.target, [...(docTags.get(r.target) ?? []), r.tag]);
  const docs = await q<{ id: string; title: string; filename: string; mime_type: string; kind: string; size_bytes: number; sha256: string; pages: number | null; created_at: Date; storage: StorageKind; storage_owner: CloudOwner; retain_until: Date | null; collection_id: string | null; folder_id: string | null; text: string; content: Buffer }>(
    "SELECT id, title, filename, mime_type, kind, size_bytes, sha256, pages, created_at, storage, storage_owner, retain_until, collection_id, folder_id, text, content FROM documents WHERE owner_id = $1 ORDER BY created_at",
    [accountId],
  );
  const analyses = await q<{ id: string; document_id: string; studio: string; status: string; run_id: string | null; created_at: Date; report: unknown }>("SELECT a.id, a.document_id, a.studio, a.status, a.run_id, a.created_at, a.report FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 ORDER BY a.created_at", [accountId]);
  const consents = await q("SELECT * FROM consents WHERE account_id = $1", [accountId]);
  const fileOf = async (d: (typeof docs)[number]) => {
    const store = stores(d.storage_owner);
    if (EXTERNAL.has(d.storage) && store && store.describe().kind === d.storage) {
      const found = await store.get(objectKey(accountId, d.id, d.mime_type));
      return found ? { contentType: d.mime_type, base64: Buffer.from(found.bytes).toString("base64") } : null;
    }
    return d.content.length > 0 ? { contentType: d.mime_type, base64: d.content.toString("base64") } : null;
  };
  return {
    exportedAt: now.toISOString(),
    profile: { id: a.id, email: a.email, name: a.name, locale: a.locale, perspective: a.perspective, createdAt: a.created_at.toISOString(), termsAcceptedAt: a.terms_accepted_at?.toISOString() ?? null, privacyAcceptedAt: a.privacy_accepted_at?.toISOString() ?? null },
    billing: { plan: a.plan, auditCredits: ledger.credits, freeAuditUsed: ledger.freeAuditUsed, subscriptionStatus: a.subscription_status, currentPeriodEnd: a.current_period_end?.toISOString() ?? null },
    libraries: libs.map((l) => ({ id: l.id, name: l.name, collections: cols.filter((c) => c.library_id === l.id).map((c) => ({ id: c.id, name: c.name, isDefault: c.is_default, tags: colTags.get(c.id) ?? [], folders: folders.filter((f) => f.collection_id === c.id).map((f) => ({ id: f.id, name: f.name, tags: folderTags.get(f.id) ?? [] })) })) })),
    tags,
    documents: await Promise.all(
      docs.map(async (d) => ({
        id: d.id, title: d.title, filename: d.filename, mimeType: d.mime_type, kind: d.kind, sizeBytes: d.size_bytes, sha256: d.sha256, pages: d.pages, createdAt: d.created_at.toISOString(),
        storage: d.storage, retainUntil: d.retain_until?.toISOString() ?? null, collectionId: d.collection_id, folderId: d.folder_id, tags: docTags.get(d.id) ?? [],
        text: d.text || null, file: await fileOf(d),
        analyses: analyses.filter((x) => x.document_id === d.id).map((x) => ({ id: x.id, studio: x.studio, status: x.status, runId: x.run_id, createdAt: x.created_at.toISOString(), report: x.report })),
      })),
    ),
    consents,
  };
}

/**
 * Erases an account (Loi 25): refuses while a subscription is active (cancel it in the portal first), deletes the kept files
 * from their store, strips the person from the audit trail (the rows stay, without name, address or detail), then deletes the identity.
 */
export async function eraseAccount(deps: { query: Query; stores: StoresOf; accounts: AccountService }, accountId: string): Promise<void> {
  const { query: q } = deps;
  const [a] = await q<{ plan: string; subscription_status: string | null }>("SELECT plan, subscription_status FROM accounts WHERE id = $1", [accountId]);
  if (!a) throw refuse(404, "NOT_FOUND", "No such account");
  if (a.plan === "PRO" && (a.subscription_status === "active" || a.subscription_status === "trialing")) throw refuse(409, "CANCEL_SUBSCRIPTION_FIRST", "Cancel the subscription first");
  const kept = await q<{ id: string; mime_type: string; storage: StorageKind; storage_owner: CloudOwner }>("SELECT id, mime_type, storage, storage_owner FROM documents WHERE owner_id = $1", [accountId]);
  for (const d of kept) {
    if (!EXTERNAL.has(d.storage)) continue;
    const store = deps.stores(d.storage_owner);
    if (!store || store.describe().kind !== d.storage) throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds a document is not available");
    await store.delete(objectKey(accountId, d.id, d.mime_type));
  }
  await q("UPDATE audit.entry SET actor_label = 'deleted account', ip = NULL, detail = '{}'::jsonb WHERE actor_id = $1 OR target_id = $2", [accountId, accountId]);
  await deps.accounts.deleteAccount(accountId);
}
