import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { deleteDocument, documentStorage, getDocument, getFile, type StoragePolicy, storeDocument } from "./documents";
import { purgeExpired, purgeIfDone } from "./retention";
import { memoryStore } from "./storage/memory";
import { noneStore } from "./storage/none";

/** Keep or purge against a real PostgreSQL (skipped without YOMIZAKA_DB_IT=1 and DATABASE_URL). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-22T12:00:00Z");
const LEASE = "BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $, payable le premier jour du mois.\n";

describe.runIf(enabled)("keep or purge (ADR-0007)", () => {
  beforeAll(async () => {
    await migrate();
  });
  const account = async () => (await query<{ id: string }>("INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id", [`r-${Math.random().toString(36).slice(2)}@yomizaka.test`]))[0]!.id;
  const bytes = (n: string) => new TextEncoder().encode(`${LEASE}${n}`);
  const file = { name: "bail.txt", type: "text/plain", size: 100 };
  const dev = () => memoryStore({ kind: "bunny", devOnly: true, owner: "krizaka", residency: "elsewhere" });
  const policy = (keep: boolean, store: ReturnType<typeof dev> | ReturnType<typeof noneStore> = noneStore()): StoragePolicy => ({ keep, store, now: NOW, purgeAfterHours: 24 });
  const finish = async (documentId: string) => {
    const [a] = await query<{ id: string }>("INSERT INTO analyses (document_id, studio, status, run_id, report, finished_at) VALUES ($1, 'compliance-check', 'succeeded', gen_random_uuid(), '{\"findings\":[]}', now()) RETURNING id", [documentId]);
    return a!.id;
  };

  it("a purge is verifiable: the content and text are empty and an audit row « document.purged » exists", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("audit"), "lease", policy(false));
    await finish(summary.id);
    expect(await purgeIfDone(query, summary.id)).toBe(true);
    const [row] = await query<{ n: number; t: string }>("SELECT octet_length(content) AS n, text AS t FROM documents WHERE id = $1", [summary.id]);
    expect(row).toEqual({ n: 0, t: "" });
    expect(await query("SELECT 1 FROM audit_log WHERE action = 'document.purged' AND target_id = $1", [summary.id])).toHaveLength(1);
  });

  it("a keep is recorded with its date", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("kept"), "lease", policy(true));
    const [row] = await query<{ keep_consent_at: Date | null }>("SELECT keep_consent_at FROM documents WHERE id = $1", [summary.id]);
    expect(row!.keep_consent_at?.toISOString()).toBe(NOW.toISOString());
  });

  it("the policy is a row: an owner's rule changes the window of the screening result, no deploy", async () => {
    const owner = await account();
    const { policyFor, resultDays, SUBJECT } = await import("./retention-policy");
    expect(resultDays(await policyFor(owner, SUBJECT.screeningResult))).toBe(30);
    await query("INSERT INTO retention_policies (id, purge_on, days) VALUES ('seven-days', 'days', 7) ON CONFLICT DO NOTHING");
    await query("INSERT INTO retention_rule (owner_id, subject, policy_id) VALUES ($1, 'screening-result', 'seven-days')", [owner]);
    expect(resultDays(await policyFor(owner, SUBJECT.screeningResult))).toBe(7);
  });

  it("a document is NOT kept by default: after its check the file and the text are purged and the report stays", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("a"), "lease", policy(false));
    const before = await documentStorage(owner, summary.id, () => noneStore().describe());
    expect(before).toMatchObject({ storage: { kind: "none" }, purged: false });
    expect(before.retainUntil).toBe("2026-10-23T12:00:00.000Z");
    await finish(summary.id);
    expect(await purgeIfDone(query, summary.id)).toBe(true);
    const after = await documentStorage(owner, summary.id, () => noneStore().describe());
    expect(after).toMatchObject({ storage: { kind: "none" }, purged: true, retainUntil: null });
    const detail = await getDocument(owner, summary.id);
    expect(detail.text).toBe("");
    expect(detail.insight).toBeUndefined();
    expect(detail.analyses).toHaveLength(1);
    expect(detail.sha256).toHaveLength(64);
    await expect(getFile(owner, summary.id)).rejects.toMatchObject({ status: 409, body: { code: "NOT_KEPT" } });
  });

  it("does not purge while another check of the document is still running", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("b"), "lease", policy(false));
    await query("INSERT INTO analyses (document_id, studio, status, run_id) VALUES ($1, 'document-authenticity', 'running', gen_random_uuid())", [summary.id]);
    expect(await purgeIfDone(query, summary.id)).toBe(false);
    expect((await documentStorage(owner, summary.id, () => noneStore().describe())).purged).toBe(false);
  });

  it("a kept document goes to the configured store (Bunny in development), leaves nothing in the database, and says so", async () => {
    const owner = await account();
    const store = dev();
    const { summary } = await storeDocument(owner, file, bytes("c"), "lease", policy(true, store));
    const info = await documentStorage(owner, summary.id, () => store.describe());
    expect(info.storage).toMatchObject({ kind: "bunny", devOnly: true });
    expect(info.purged).toBe(false);
    const [row] = await query<{ n: number }>("SELECT octet_length(content) AS n FROM documents WHERE id = $1", [summary.id]);
    expect(row!.n).toBe(0);
    expect(store.size()).toBe(1);
    expect((await getFile(owner, summary.id, store)).content.toString()).toContain("1 450");
    expect((await getDocument(owner, summary.id)).text).toContain("Loyer mensuel");
    await finish(summary.id);
    expect(await purgeIfDone(query, summary.id)).toBe(false);
    await deleteDocument(owner, summary.id, store);
    expect(store.size()).toBe(0);
  });

  it("a kept document with no external store stays in Krizaka's database", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("d"), "lease", policy(true));
    expect((await documentStorage(owner, summary.id, () => noneStore().describe())).storage).toMatchObject({ kind: "database", residency: "canada" });
    expect((await getFile(owner, summary.id)).content.toString()).toContain("Loyer");
  });

  it("when the store does not answer, the upload fails cleanly and nothing is left", async () => {
    const owner = await account();
    const broken = {
      ...dev(),
      put: async () => {
        throw new Error("down");
      },
    };
    await expect(storeDocument(owner, file, bytes("e"), "lease", policy(true, broken))).rejects.toMatchObject({ status: 502, body: { code: "STORAGE_UNAVAILABLE" } });
    expect(await query("SELECT 1 FROM documents WHERE owner_id = $1", [owner])).toHaveLength(0);
  });

  it("uploading a purged document again with « conserver » restores it; without, it is reused as it is", async () => {
    const owner = await account();
    const first = await storeDocument(owner, file, bytes("f"), "lease", policy(false));
    await finish(first.summary.id);
    await purgeIfDone(query, first.summary.id);
    const again = await storeDocument(owner, file, bytes("f"), "lease", policy(false));
    expect(again).toMatchObject({ duplicate: true, summary: { id: first.summary.id } });
    const restored = await storeDocument(owner, file, bytes("f"), "lease", policy(true));
    expect(restored).toMatchObject({ duplicate: false, summary: { id: first.summary.id } });
    expect((await getDocument(owner, first.summary.id)).text).toContain("Loyer");
    expect((await documentStorage(owner, first.summary.id, () => noneStore().describe())).purged).toBe(false);
    expect((await getDocument(owner, first.summary.id)).analyses).toHaveLength(1);
  });

  it("the sweep purges a not-kept document that was never checked, once its deadline has passed", async () => {
    const owner = await account();
    const { summary } = await storeDocument(owner, file, bytes("g"), "lease", policy(false));
    expect(await purgeExpired(query, new Date("2026-10-22T13:00:00Z"))).toBe(0);
    expect(await purgeExpired(query, new Date("2026-10-23T12:00:01Z"))).toBeGreaterThanOrEqual(1);
    expect((await documentStorage(owner, summary.id, () => noneStore().describe())).purged).toBe(true);
  });
});
