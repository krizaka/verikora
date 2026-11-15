import type { DocumentStore } from "@verikora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HeldRow } from "./deletion-receipt";
import type { HeldObject, ObjectHolder } from "./document-objects";

interface Audited {
  action: string;
  actorId: string | null;
  actorLabel: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}
interface Receipt {
  rowId: string;
  rule: string;
  now: Date | undefined;
}
const audits: Audited[] = [];
const receipts: Receipt[] = [];

vi.mock("./audit", () => ({ audit: async (entry: Audited) => void audits.push(entry) }));
vi.mock("./deletion-receipt", async (original) => ({
  ...(await original<typeof import("./deletion-receipt")>()),
  recordDeletionReceipt: async (_q: unknown, row: HeldRow, rule: string, now: Date | undefined) =>
    void receipts.push({ rowId: row.id, rule, now }),
}));

import { HOLDS_BYTES, purgeDocument, purgeExpired, purgeIfDone, type Query } from "./retention";

const NOW = new Date("2026-11-15T10:00:00Z");
const KEY = "tenants/t/users/o/documents/doc-1/original.pdf";

type Call = { text: string; values: unknown[] };
type Row = Record<string, unknown>;

function fakeDb(answer: (text: string, values: unknown[]) => Row[]) {
  const calls: Call[] = [];
  const q = (async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    return answer(text, values);
  }) as Query;
  return { q, calls, sqlOf: (needle: string) => calls.filter((c) => c.text.includes(needle)) };
}

const held = (id: string, over: Partial<HeldRow & { storage_owner: string }> = {}) => ({
  id,
  owner_id: "owner-1",
  screening_id: null,
  storage: "none",
  object_key: null,
  sha256: "a".repeat(64),
  has_file: true,
  has_text: true,
  text_sha256: "b".repeat(64),
  storage_owner: "krizaka",
  ...over,
});

/** The database of a sweep: the candidates it selects, and the rows its UPDATE empties. */
function sweep(candidates: Row[]) {
  return fakeDb((text, values) => {
    if (text.startsWith("SELECT")) {
      return candidates;
    }
    if (text.startsWith("UPDATE documents")) {
      const ids = values[0] as string[];
      return ids.map((id) => ({ id }));
    }
    return [];
  });
}

const storeThat = (deleted: string[], failing = false): DocumentStore =>
  ({
    delete: async (key: string) => {
      if (failing) {
        throw new Error("store down");
      }
      deleted.push(key);
    },
  }) as unknown as DocumentStore;

beforeEach(() => {
  audits.length = 0;
  receipts.length = 0;
});

describe("purging one document", () => {
  it("empties a database-held file and its text, then audits and receipts it under the after-check rule", async () => {
    const db = sweep([held("doc-1")]);
    expect(await purgeDocument(db.q, "doc-1", "after-check", undefined, NOW)).toBe(true);

    const [select] = db.sqlOf("SELECT");
    expect(select!.text).toContain("WHERE storage = 'none' AND id = $1");
    expect(select!.text).toContain(HOLDS_BYTES);
    expect(select!.values).toEqual(["doc-1"]);
    const [update] = db.sqlOf("UPDATE documents");
    expect(update!.text).toContain(
      "content = ''::bytea, text = '', object_key = NULL, retain_until = NULL, storage = 'none'",
    );
    expect(update!.values).toEqual([["doc-1"]]);
    expect(audits).toEqual([
      {
        action: "document.purged",
        actorId: null,
        actorLabel: "retention",
        targetId: "doc-1",
        detail: { reason: "after-check" },
      },
    ]);
    expect(receipts).toEqual([{ rowId: "doc-1", rule: "after-check", now: NOW }]);
  });

  it("says why in the audit line", async () => {
    const db = sweep([held("doc-1")]);
    await purgeDocument(db.q, "doc-1", "manager-request");
    expect(audits[0]!.detail).toEqual({ reason: "manager-request" });
    expect(receipts[0]!.now).toBeUndefined();
  });

  it("is false when nothing holds bytes or text any more", async () => {
    const db = sweep([]);
    expect(await purgeDocument(db.q, "doc-1")).toBe(false);
    expect(db.sqlOf("UPDATE documents")).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("deletes the stored file FIRST, through the holder of its store, and only then clears the row", async () => {
    const deleted: string[] = [];
    const asked: HeldObject[] = [];
    const holder: ObjectHolder = async (row) => {
      asked.push(row);
      return storeThat(deleted);
    };
    const db = sweep([held("doc-1", { storage: "s3", object_key: KEY })]);
    expect(await purgeDocument(db.q, "doc-1", "after-check", holder)).toBe(true);
    expect(deleted).toEqual([KEY]);
    expect(asked[0]).toMatchObject({ owner_id: "owner-1", storage: "s3", storage_owner: "krizaka" });
    expect(db.sqlOf("UPDATE documents")).toHaveLength(1);
  });

  it("keeps the row and its deadline when no store is available for its file: the next sweep retries", async () => {
    const db = sweep([held("doc-1", { storage: "s3", object_key: "k" })]);
    expect(await purgeDocument(db.q, "doc-1")).toBe(false);
    expect(db.sqlOf("UPDATE documents")).toEqual([]);
    expect(audits).toEqual([]);
    expect(receipts).toEqual([]);
  });

  it("keeps the row when the store does not answer the delete", async () => {
    const holder: ObjectHolder = async () => storeThat([], true);
    const db = sweep([held("doc-1", { storage: "s3", object_key: "k" })]);
    expect(await purgeDocument(db.q, "doc-1", "after-check", holder)).toBe(false);
    expect(db.sqlOf("UPDATE documents")).toEqual([]);
  });

  it("purges the ones whose store answered and leaves the others", async () => {
    const deleted: string[] = [];
    const holder: ObjectHolder = async (row) => (row.object_key === "good" ? storeThat(deleted) : null);
    const db = sweep([held("a", { object_key: "good" }), held("b", { object_key: "bad" }), held("c")]);
    await purgeDocument(db.q, "x", "after-check", holder);
    expect(db.sqlOf("UPDATE documents")[0]!.values).toEqual([["a", "c"]]);
    expect(receipts.map((r) => r.rowId)).toEqual(["a", "c"]);
  });
});

describe("purging after a check", () => {
  it("purges when no other check of the document is running and no batch row waits for it", async () => {
    const db = fakeDb((text) =>
      text.startsWith("SELECT 1") ? [] : text.startsWith("SELECT") ? [held("doc-1")] : [{ id: "doc-1" }],
    );
    expect(await purgeIfDone(db.q, "doc-1")).toBe(true);
    const [probe] = db.sqlOf("SELECT 1");
    expect(probe!.text).toContain("status = 'running'");
    expect(probe!.text).toContain("batch_items WHERE document_id = $1 AND state = 'pending'");
    expect(probe!.values).toEqual(["doc-1"]);
    expect(audits[0]!.detail).toEqual({ reason: "after-check" });
  });

  it("keeps the document while another check or a batch row still needs it", async () => {
    const db = fakeDb(() => [{ "?column?": 1 }]);
    expect(await purgeIfDone(db.q, "doc-1")).toBe(false);
    expect(db.calls).toHaveLength(1);
    expect(audits).toEqual([]);
  });
});

describe("the sweep", () => {
  it("purges the not-kept documents past their deadline, then the one-year class, and counts both", async () => {
    let selects = 0;
    const db = fakeDb((text, values) => {
      if (text.startsWith("SELECT")) {
        return selects++ === 0 ? [held("window-1"), held("window-2")] : [held("year-1")];
      }
      return (values[0] as string[]).map((id) => ({ id }));
    });
    expect(await purgeExpired(db.q, NOW)).toBe(3);

    const [first, second] = db.sqlOf("SELECT");
    expect(first!.text).toContain("WHERE storage = 'none' AND retain_until IS NOT NULL AND retain_until <= $1");
    expect(first!.values).toEqual([NOW]);
    expect(second!.text).toContain("WHERE retention_policy = 'one-year-after-decision' AND retain_until IS NOT NULL");
    expect(db.sqlOf("UPDATE documents")[1]!.text).toContain(
      "AND retention_policy = 'one-year-after-decision' RETURNING id",
    );

    expect(audits.map((a) => [a.targetId, a.detail])).toEqual([
      ["window-1", { reason: "window" }],
      ["window-2", { reason: "window" }],
      ["year-1", { reason: "one-year-after-decision" }],
    ]);
    expect(receipts).toEqual([
      { rowId: "window-1", rule: "window", now: NOW },
      { rowId: "window-2", rule: "window", now: NOW },
      { rowId: "year-1", rule: "one-year-after-decision", now: NOW },
    ]);
  });

  it("purges nothing and says zero when nothing is due", async () => {
    const db = sweep([]);
    expect(await purgeExpired(db.q, NOW)).toBe(0);
    expect(db.sqlOf("UPDATE documents")).toEqual([]);
  });
});
