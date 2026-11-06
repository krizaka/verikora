import {
  type Actor,
  type Clock,
  createWorkspace,
  dbWorkspaceStore,
  type Query as LayerQuery,
  type StatusMove,
  type Workspace,
  type WorkspaceEvents,
} from "@krizaka/organize";

import { holderOf as documentHolder } from "@/app/active-store";

import { auditIn } from "../audit";
import { transaction } from "../db";
import { removeObject } from "../document-objects";
import { refuse } from "../http";
import { EXTERNAL, HOLDS_BYTES, objectKey } from "../retention";
import type { DocumentStore } from "../storage/port";
import { KIND, KINDS, OWNER_ROLE, WORKSPACE } from "./decl";
import { DEFAULT_CONFIGS } from "./defaults";

/**
 * Verikora's wiring of the workspace layer (krizaka-ts ADR-003, verikora#324): the package owns the rules (roles, transitions,
 * the row locks, one audit line per entity); this module gives it the account's transaction, the audit trail, the clock and the
 * product's own consequence of a decision. Nothing here decides who may do what — the layer's configuration does.
 */

/** The manager acting: their account is the scope and their role in it. */
export const actorOf = (account: { id: string; email: string }): Actor => ({
  id: account.id,
  label: account.email,
  role: OWNER_ROLE,
});

export interface WorkspaceOptions {
  clock: Clock;
  /** Where the kept files live (the account's store): needed to purge them when a decision closes a file. */
  store?: DocumentStore;
  /** The request's headers, for the audit lines' address. */
  headers?: Headers;
  /** Where the layer's events go in the decision's transaction (the webhooks, when the account has them). */
  events?: WorkspaceEvents;
}

const asLayerQuery = (run: (text: string, values?: unknown[]) => Promise<unknown>): LayerQuery =>
  ((sql: string, params?: unknown[]) => run(sql, params)) as LayerQuery;

/**
 * A decision closes the file (the link with it) and purges every document it holds — their bytes and text, from the database and
 * from the store; the reports stay (Loi 25 minimisation, #125). It runs in the decision's own transaction: if the kept files'
 * store is not there, nothing is decided. The store's objects go last, so a failure before leaves the files whole.
 */
export async function closeDecidedFiles(
  tx: LayerQuery,
  moves: readonly StatusMove[],
  options: Pick<WorkspaceOptions, "store" | "headers">,
): Promise<void> {
  const decided = moves.filter((m) => m.final && m.kind === KIND.applicantFile);
  const [first] = decided;
  if (!first) return;
  const owner = first.scope;
  const ids = decided.map((m) => m.entityId);
  const held = await tx<{
    id: string;
    screening_id: string;
    mime_type: string;
    storage: string;
    storage_owner: string;
    object_key: string | null;
  }>(
    `SELECT id, screening_id, mime_type, storage, storage_owner, object_key FROM documents WHERE owner_id = $1 AND screening_id = ANY($2::uuid[]) AND (storage <> 'none' OR ${HOLDS_BYTES} OR text <> '') ORDER BY id FOR UPDATE`,
    [owner, ids],
  );
  for (const d of held) {
    const external = !d.object_key && EXTERNAL.has(d.storage as never);
    if (external && (!options.store || options.store.describe().kind !== d.storage))
      throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds these documents is not available");
  }
  await tx(
    "UPDATE screenings SET closed_at = $3, revoked_at = coalesce(revoked_at, $3) WHERE landlord_id = $1 AND id = ANY($2::uuid[]) AND closed_at IS NULL",
    [owner, ids, first.at],
  );
  if (held.length)
    await tx(
      "UPDATE documents SET content = ''::bytea, text = '', object_key = NULL, storage = 'none', retain_until = NULL WHERE id = ANY($1::uuid[])",
      [held.map((d) => d.id)],
    );
  for (const m of decided) {
    const purged = held.filter((d) => d.screening_id === m.entityId).length;
    await auditIn(tx, {
      action: "applicant_file.closed",
      actorId: owner,
      actorLabel: "manager",
      targetId: m.entityId,
      detail: { purged, decision: m.to },
      headers: options.headers,
    });
  }
  for (const d of held) {
    // The stored file goes last: a store that does not answer rolls the whole decision back, the files stay whole (ADR-0012).
    if (d.object_key) {
      if (
        !(await removeObject(
          { owner_id: owner, storage: d.storage, storage_owner: d.storage_owner, object_key: d.object_key },
          documentHolder,
        ))
      )
        throw refuse(409, "STORAGE_UNAVAILABLE", "The storage that holds these documents is not available");
    } else if (EXTERNAL.has(d.storage as never)) await options.store!.delete(objectKey(owner, d.id, d.mime_type));
  }
}

/** The layer over the account's database, for one request. */
export function workspaceFor(options: WorkspaceOptions): Workspace {
  return createWorkspace({
    transaction: (work) => transaction((run) => work(asLayerQuery(run))),
    storeFor: (tx) => dbWorkspaceStore(tx, WORKSPACE),
    clock: options.clock,
    audit: {
      record: (q, entry) =>
        auditIn(q, {
          action: entry.action,
          actorId: entry.actorId,
          actorLabel: entry.actorLabel,
          targetId: entry.target?.id ?? null,
          detail: { ...entry.detail, ...(entry.target ? { kind: entry.target.type } : {}) },
          headers: options.headers,
        }),
    },
    events: options.events,
    onMoved: (tx, moves) => closeDecidedFiles(tx, moves, options),
  });
}

/** Seeds the defaults of both kinds, once: afterwards the database is the source of truth and only the administration changes it. */
export async function seedWorkspace(clock: Clock): Promise<string[]> {
  const workspace = workspaceFor({ clock });
  const seeded: string[] = [];
  for (const kind of KINDS) {
    if (await workspace.config.get(kind)) continue;
    await workspace.config.seed(DEFAULT_CONFIGS[kind]);
    seeded.push(kind);
  }
  return seeded;
}
