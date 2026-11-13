import crypto from "node:crypto";

import type { QueryResultRow } from "pg";
import { z } from "zod";

import { audit } from "./audit";
import { canonicalJson, sha256 } from "./report";
import type { SigningKey } from "./report-key";
import { signingKey } from "./report-signer";

/*
 * The deletion receipt (krizaka-internal#3381): when the bytes of a document are gone (purged by the retention rules, by the manager's
 * decision, or erased at the applicant's request), one short signed record says what was deleted, when and under which rule.
 * It is signed with THE report's key (lib/report-signer.ts) over the canonical payload, like a report, and verified on the same
 * /api/verify path. It holds ids, kinds and hashes only: never a name, an e-mail, a file name or a title.
 */
export const DELETION_RECEIPT_SCHEMA = "verikora.deletion-receipt/1";

/** The rule a deletion ran under: a retention class, the manager's decision, or the applicant's request. */
export const DELETION_RULE = {
  afterCheck: "after-check",
  window: "window",
  afterDecision: "after-decision",
  applicantRequest: "applicant-request",
} as const;
export type DeletionRule = (typeof DELETION_RULE)[keyof typeof DELETION_RULE];

/** `deleted`: the store confirmed the object is gone; `cleared`: the bytes were held in the database and emptied. */
export type DeletionResult = "deleted" | "cleared";
export interface DeletedObject {
  kind: "file" | "text";
  sha256: string;
  store: string;
  result: DeletionResult;
}

const hex = z.string().regex(/^[0-9a-f]{64}$/);
export const deletionReceiptPayload = z
  .object({
    schema: z.literal(DELETION_RECEIPT_SCHEMA),
    receiptId: z.string().uuid(),
    document: z.string().uuid(),
    application: z.string().uuid().nullable(),
    rule: z.enum([
      DELETION_RULE.afterCheck,
      DELETION_RULE.window,
      DELETION_RULE.afterDecision,
      DELETION_RULE.applicantRequest,
    ]),
    deletedAt: z.string(),
    objects: z.array(
      z
        .object({
          kind: z.enum(["file", "text"]),
          sha256: hex,
          store: z.string(),
          result: z.enum(["deleted", "cleared"]),
        })
        .strict(),
    ),
  })
  .strict();
export type DeletionReceiptPayload = z.infer<typeof deletionReceiptPayload>;

const envelope = z.object({
  schema: z.literal(DELETION_RECEIPT_SCHEMA),
  algorithm: z.literal("Ed25519"),
  keyId: z.string(),
  payload: deletionReceiptPayload,
  signature: z.string(),
});

export interface ReceiptInput {
  receiptId: string;
  documentId: string;
  applicationId: string | null;
  rule: DeletionRule;
  deletedAt: Date;
  objects: DeletedObject[];
}

/** Signs the receipt: the same input and key give the same bytes. */
export function issueDeletionReceipt(input: ReceiptInput, key: SigningKey): { body: string; sha256: string } {
  const payload: DeletionReceiptPayload = {
    schema: DELETION_RECEIPT_SCHEMA,
    receiptId: input.receiptId,
    document: input.documentId,
    application: input.applicationId,
    rule: input.rule,
    deletedAt: input.deletedAt.toISOString(),
    objects: input.objects,
  };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload)), key.privateKey).toString("base64");
  const body = canonicalJson({
    schema: DELETION_RECEIPT_SCHEMA,
    algorithm: "Ed25519",
    keyId: key.keyId,
    payload,
    signature,
  });
  return { body, sha256: sha256(body) };
}

export type ReceiptFailure = "NOT_A_RECEIPT" | "UNREADABLE" | "UNKNOWN_KEY" | "BAD_SIGNATURE";
export type ReceiptVerification =
  | { ok: true; fileSha256: string; keyId: string; payload: DeletionReceiptPayload }
  | { ok: false; reason: ReceiptFailure; fileSha256: string };

/** True when the text declares the deletion-receipt schema (read, not trusted): the verify path picks its verifier by it. */
export function receiptSchemaOf(text: string): boolean {
  try {
    return (JSON.parse(text) as { schema?: unknown } | null)?.schema === DELETION_RECEIPT_SCHEMA;
  } catch {
    return false;
  }
}

/** Checks a receipt against the report's public key. Never throws on hostile input. */
export function verifyDeletionReceipt(text: string, key: Pick<SigningKey, "keyId" | "publicKey">): ReceiptVerification {
  const fileSha256 = sha256(text);
  const fail = (reason: ReceiptFailure): ReceiptVerification => ({ ok: false, reason, fileSha256 });
  if (!receiptSchemaOf(text)) {
    return fail("NOT_A_RECEIPT");
  }
  const parsed = envelope.safeParse(JSON.parse(text));
  if (!parsed.success) {
    return fail("UNREADABLE");
  }
  const { keyId, payload, signature } = parsed.data;
  if (keyId !== key.keyId) {
    return fail("UNKNOWN_KEY");
  }
  const signed = crypto.verify(
    null,
    Buffer.from(canonicalJson(payload)),
    key.publicKey,
    Buffer.from(signature, "base64"),
  );
  return signed ? { ok: true, fileSha256, keyId, payload } : fail("BAD_SIGNATURE");
}

/** What the verify page shows of a receipt: only what is in its payload (ids are left out), never a name. */
export type DeletionReceiptView =
  | {
      kind: "deletion-receipt";
      ok: true;
      fileSha256: string;
      keyId: string;
      deletedAt: string;
      rule: DeletionRule;
      objects: DeletedObject[];
    }
  | { kind: "deletion-receipt"; ok: false; reason: ReceiptFailure; fileSha256: string };

export const receiptView = (result: ReceiptVerification): DeletionReceiptView =>
  result.ok
    ? {
        kind: "deletion-receipt",
        ok: true,
        fileSha256: result.fileSha256,
        keyId: result.keyId,
        deletedAt: result.payload.deletedAt,
        rule: result.payload.rule,
        objects: result.payload.objects,
      }
    : { kind: "deletion-receipt", ok: false, reason: result.reason, fileSha256: result.fileSha256 };

export type Query = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<T[]>;

/** What a row holds, read BEFORE it is emptied: the columns every deletion path selects (the file's hash, the text's hash, where it lives). */
export const HELD_COLUMNS = `id, owner_id, screening_id, storage, object_key, sha256,
  (object_key IS NOT NULL OR octet_length(content) > 0) AS has_file,
  (text <> '') AS has_text,
  encode(sha256(convert_to(text, 'UTF8')), 'hex') AS text_sha256`;

export interface HeldRow {
  id: string;
  owner_id: string;
  screening_id: string | null;
  storage: string;
  object_key: string | null;
  sha256: string;
  has_file: boolean;
  has_text: boolean;
  text_sha256: string;
}

/** The objects a deletion removed, from the row as it was: the file (in the store, or in the database) and its text. */
export const objectsOf = (row: HeldRow): DeletedObject[] => [
  ...(row.has_file
    ? [
        {
          kind: "file" as const,
          sha256: row.sha256,
          store: row.object_key ? row.storage : "database",
          result: row.object_key ? ("deleted" as const) : ("cleared" as const),
        },
      ]
    : []),
  ...(row.has_text
    ? [{ kind: "text" as const, sha256: row.text_sha256, store: "database", result: "cleared" as const }]
    : []),
];

/**
 * Writes the receipt of a deletion that is DONE: call it only after the store confirmed the object is gone. One receipt per
 * document and rule. A receipt that cannot be written never undoes the deletion (the bytes are gone): the failure is audited, with no name.
 */
export async function recordDeletionReceipt(
  q: Query,
  row: HeldRow,
  rule: DeletionRule,
  now: Date | undefined,
  key: () => SigningKey = signingKey,
): Promise<void> {
  try {
    const receiptId = crypto.randomUUID();
    // The caller's clock when it has one, else the database's: the deletion is recorded at the moment it was done.
    const at = now ?? (await q<{ t: Date }>("SELECT now() AS t"))[0]!.t;
    const { body, sha256: fileSha256 } = issueDeletionReceipt(
      { receiptId, documentId: row.id, applicationId: row.screening_id, rule, deletedAt: at, objects: objectsOf(row) },
      key(),
    );
    await q(
      "INSERT INTO deletion_receipts (id, owner_id, document_id, screening_id, rule, body, sha256, issued_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (document_id, rule) DO NOTHING",
      [receiptId, row.owner_id, row.id, row.screening_id, rule, body, fileSha256, at],
    );
  } catch {
    await audit({
      action: "document.receipt_failed",
      actorId: null,
      actorLabel: "retention",
      targetId: row.id,
      detail: { rule },
    });
  }
}
