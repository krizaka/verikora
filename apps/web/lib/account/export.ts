import type { CloudOwner, StorageKind } from "@yomizaka/core";
import type { QueryResultRow } from "pg";

import { workingStore } from "@/app/active-store";

import { ledgerState } from "../billing";
import type { ObjectHolder } from "../document-objects";
import { refuse } from "../http";
import { EXTERNAL, objectKey } from "../retention";
import type { DocumentStore } from "../storage/port";

/** The store that holds a document: Krizaka's configured one, or the owner's own cloud. */
export type StoresOf = (owner: CloudOwner) => DocumentStore | null;

/** The holder of a stored file (ADR-0012): the given stores for a kept document, the working store for the rest. */
export const holderFrom = (stores: StoresOf): ObjectHolder => async (row) => (EXTERNAL.has(row.storage as never) ? stores(row.storage_owner as CloudOwner) : workingStore());

/**
 * What belongs to Yomizaka and not to the account port, for the export (Loi 25, access): the person's profile, billing state,
 * organisation, documents with their kept files, and reports. It is the « yomizaka » part of the privacy export (`lib/privacy.ts`).
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
  const docs = await q<{ id: string; title: string; filename: string; mime_type: string; kind: string; size_bytes: number; sha256: string; pages: number | null; created_at: Date; storage: StorageKind; storage_owner: CloudOwner; retain_until: Date | null; collection_id: string | null; folder_id: string | null; text: string; content: Buffer; object_key: string | null }>(
    "SELECT id, title, filename, mime_type, kind, size_bytes, sha256, pages, created_at, storage, storage_owner, retain_until, collection_id, folder_id, text, content, object_key FROM documents WHERE owner_id = $1 ORDER BY created_at",
    [accountId],
  );
  const analyses = await q<{ id: string; document_id: string; studio: string; status: string; run_id: string | null; created_at: Date; report: unknown }>("SELECT a.id, a.document_id, a.studio, a.status, a.run_id, a.created_at, a.report FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 ORDER BY a.created_at", [accountId]);
  const fileOf = async (d: (typeof docs)[number]) => {
    // A file in the store (ADR-0012) is read by its key from whoever holds it.
    if (d.object_key) {
      // A cloud the person disconnected cannot be read: the export says so for that file instead of failing as a whole (the file is in their own cloud).
      const held = await (await holderFrom(stores)({ owner_id: accountId, storage: d.storage, storage_owner: d.storage_owner, object_key: d.object_key }))?.get(d.object_key).catch((error: unknown) => {
        if ((error as { body?: { code?: unknown } }).body?.code === "STORAGE_DISCONNECTED") return null;
        throw error;
      });
      return held ? { contentType: d.mime_type, base64: Buffer.from(held.bytes).toString("base64") } : null;
    }
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
  };
}
