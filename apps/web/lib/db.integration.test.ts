import { hashPassword } from "@krizaka/auth";
import { ODT_MIME } from "@verikora/core";
import { beforeAll, describe, expect, it } from "vitest";

import { listUsers } from "./accounts";
import { allDocuments, allRuns, auditLog, overview, setUserStatus, userDetail } from "./admin";
import { migrate, pool, query } from "./db";
import { deleteDocument, getDocument, getFile, listDocuments, storeDocument } from "./documents";
import { zipOf } from "./preflight/fixtures";
import { search } from "./search";
import { createSession, resolveSession, revokeSession } from "./session";
import { getShowcase, setSample, setShowcase, showcaseFile } from "./showcase";
import { localStore } from "./storage/local";

/**
 * The SQL against a real PostgreSQL 16 (CI's service; locally `DATABASE_IT=1 DATABASE_URL=… pnpm test`): the
 * migrations, the library, the analyses' state, search, the administration list, sessions. Skipped without a database.
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("database", () => {
  const email = `it-${Date.now()}@verikora.test`;
  let owner: { id: string } | undefined;
  let stranger: { id: string } | undefined;

  beforeAll(async () => {
    await migrate();
    [owner] = await query<{ id: string }>("INSERT INTO accounts (email, password_hash) VALUES ($1, $2) RETURNING id", [
      email,
      await hashPassword("integration password"),
    ]);
    [stranger] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [
      `other-${email}`,
    ]);
  });
  const LEASE = "CONTRAT DE LOCATION\nLoyer mensuel : 850 € hors charges.\nDépôt de garantie : 2 550 €.";

  it("migrates once, idempotently", async () => {
    expect(await migrate()).toEqual([]);
  });

  it("stores a document, its text and its fingerprint — the same file twice is one document", async () => {
    const file = { name: "bail-dupont.txt", type: "text/plain", size: LEASE.length };
    const first = await storeDocument(owner!.id, file, new TextEncoder().encode(LEASE), "lease");
    expect(first.duplicate).toBe(false);
    expect(first.summary).toMatchObject({
      title: "bail dupont",
      kind: "lease",
      status: "stored",
      hasText: true,
      mimeType: "text/plain",
    });
    const again = await storeDocument(owner!.id, file, new TextEncoder().encode(LEASE), "other");
    expect(again).toMatchObject({ duplicate: true, summary: { id: first.summary.id } });
    expect((await listDocuments(owner!.id)).map((d) => d.id)).toContain(first.summary.id);
    expect((await getFile(owner!.id, first.summary.id, localStore())).content.toString()).toBe(LEASE);
  });

  it("stores OpenDocument text after widening the MIME constraint, and makes its text searchable", async () => {
    const bytes = zipOf([
      { name: "mimetype", data: Buffer.from(ODT_MIME), stored: true },
      { name: "content.xml", data: Buffer.from("<text:p>OpenDocument locataire</text:p>") },
    ]);
    const stored = await storeDocument(
      owner!.id,
      { name: "bail.odt", type: ODT_MIME, size: bytes.length },
      bytes,
      "lease",
    );
    try {
      expect(stored.summary).toMatchObject({ mimeType: ODT_MIME, hasText: true, pages: null });
      expect((await getDocument(owner!.id, stored.summary.id)).text).toBe("OpenDocument locataire");
      expect((await getFile(owner!.id, stored.summary.id, localStore())).content).toEqual(Buffer.from(bytes));
      expect((await search(owner!.id, "locataire")).some((hit) => hit.documentId === stored.summary.id)).toBe(true);
    } finally {
      await deleteDocument(owner!.id, stored.summary.id, localStore());
    }
  });

  it("keeps a document to its owner: another person gets a 404", async () => {
    const [doc] = await listDocuments(owner!.id);
    await expect(getDocument(stranger!.id, doc!.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteDocument(stranger!.id, doc!.id)).rejects.toMatchObject({ status: 404 });
    expect(await listDocuments(stranger!.id)).toEqual([]);
  });

  it("derives the document's state from its latest analysis, and searches its findings", async () => {
    const [doc] = await listDocuments(owner!.id);
    const report = {
      rulesetId: "fr-residential-lease",
      rulesetVersion: "2026-07-01",
      jurisdiction: "FR",
      asOf: "2026-10-14",
      findings: [
        {
          ruleId: "FR-LEASE-005",
          severity: "BLOCKING",
          verdict: "FAIL",
          explanation: "Le dépôt de garantie excède un mois de loyer.",
          evidenceSpan: { quote: "Dépôt de garantie : 2 550 €" },
        },
      ],
      attention: true,
    };
    await query(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, search_text) VALUES ($1, 'compliance-check', 'succeeded', '8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c', $2, $3)",
      [doc!.id, JSON.stringify(report), "FR-LEASE-005 Le dépôt de garantie excède un mois de loyer."],
    );
    const detail = await getDocument(owner!.id, doc!.id);
    expect(detail.status).toBe("attention");
    expect(detail.analyses[0]).toMatchObject({ runId: "8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c", status: "succeeded" });
    expect(detail.analyses[0]!.report).not.toHaveProperty("attention");
    const hits = await search(owner!.id, "excède");
    expect(hits.some((h) => h.source === "finding" && h.passage.includes("<b>excède</b>"))).toBe(true);
    expect((await search(owner!.id, "loyer mensuel")).some((h) => h.source === "text")).toBe(true);
    expect(await search(stranger!.id, "excède")).toEqual([]);
    expect(await search(owner!.id, "<script>")).toEqual([]);
  });

  it("shows a finding once per document, from the latest run of the same check — a re-run does not pile up duplicates (#54)", async () => {
    const [doc] = await listDocuments(owner!.id);
    const before = (await search(owner!.id, "excède")).filter(
      (h) => h.documentId === doc!.id && h.source === "finding",
    ).length;
    for (const run of ["a1111111-1d2c-4b8a-9a55-0d1e2f3a4b5c", "b2222222-1d2c-4b8a-9a55-0d1e2f3a4b5c"]) {
      await query(
        "INSERT INTO analyses (document_id, studio, status, run_id, report, search_text) VALUES ($1, 'compliance-check', 'succeeded', $2, '{}', 'FR-LEASE-005 Le dépôt de garantie excède un mois de loyer')",
        [doc!.id, run],
      );
    }
    expect(before).toBe(1);
    const after = (await search(owner!.id, "excède")).filter((h) => h.documentId === doc!.id && h.source === "finding");
    expect(after).toHaveLength(1);
    await query("DELETE FROM analyses WHERE run_id = ANY($1)", [
      ["a1111111-1d2c-4b8a-9a55-0d1e2f3a4b5c", "b2222222-1d2c-4b8a-9a55-0d1e2f3a4b5c"],
    ]);
  });

  it("lists the accounts with their documents for the administration", async () => {
    const users = await listUsers();
    expect(users.find((u) => u.email === email)).toMatchObject({ role: "USER", status: "ACTIVE", documents: 1 });
  });

  it("gives the administration its overview, documents, runs, audit and the suspension of an account", async () => {
    const o = await overview();
    expect(o.accounts).toBeGreaterThanOrEqual(2);
    expect(o.runs.succeeded).toBeGreaterThanOrEqual(1);
    expect((await allDocuments()).find((d) => d.owner === email)).toMatchObject({ kind: "lease", analyses: 1 });
    expect((await allRuns()).find((r) => r.owner === email)).toMatchObject({
      status: "succeeded",
      runId: "8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c",
    });
    const admin = { id: stranger!.id, email: `other-${email}` };
    await expect(setUserStatus(admin, admin.id, "SUSPENDED")).rejects.toMatchObject({ status: 409 });
    expect((await setUserStatus(admin, owner!.id, "SUSPENDED")).status).toBe("SUSPENDED");
    expect((await userDetail(owner!.id)).sessions).toBe(0);
    expect((await setUserStatus(admin, owner!.id, "ACTIVE")).status).toBe("ACTIVE");
    expect((await auditLog(10, owner!.id)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["admin.user_suspended", "admin.user_restored"]),
    );
  });

  it("shows publicly only a promoted check on a sample document, one at a time", async () => {
    const admin = { id: stranger!.id, email: `other-${email}` };
    const [doc] = await query<{ id: string }>(
      "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 'Showcase lease', 's.txt', 'text/plain', 4, $2, 'bail', 'bail') RETURNING id",
      [owner!.id, `showcase-${Date.now()}`],
    );
    const run = async (n: number) =>
      (
        await query<{ id: string }>(
          "INSERT INTO analyses (document_id, studio, status, run_id, report, finished_at) VALUES ($1, 'compliance-check', 'succeeded', $2, $3, now()) RETURNING id",
          [
            doc!.id,
            `run-${n}`,
            JSON.stringify({
              rulesetId: "r",
              rulesetVersion: "1",
              jurisdiction: "QC",
              asOf: "2026-10-15",
              findings: [],
            }),
          ],
        )
      )[0]!.id;
    const [a, b] = [await run(1), await run(2)];
    await expect(setShowcase(admin, a, true)).rejects.toMatchObject({ body: { code: "NOT_A_SAMPLE" } });
    expect(await getShowcase()).toBeNull();
    await setSample(admin, doc!.id, true);
    await setShowcase(admin, a, true);
    expect((await getShowcase())?.runId).toBe("run-1");
    await setShowcase(admin, b, true);
    expect((await getShowcase())?.runId).toBe("run-2");
    expect(await query("SELECT id FROM analyses WHERE showcase")).toHaveLength(1);
    expect((await showcaseFile())?.filename).toBe("s.txt");
    await setSample(admin, doc!.id, false);
    expect(await getShowcase()).toBeNull();
    expect(await showcaseFile()).toBeNull();
    expect((await auditLog(20, doc!.id)).map((e) => e.action)).toEqual(
      expect.arrayContaining(["admin.document_sample_set", "admin.document_sample_unset"]),
    );
  });

  it("opens, resolves and ends a session — a suspended account has none", async () => {
    const { token } = await createSession(owner!.id, { ip: "203.0.113.7", userAgent: "vitest" });
    expect((await resolveSession(token))?.account.email).toBe(email);
    await query("UPDATE accounts SET status = 'SUSPENDED' WHERE id = $1", [owner!.id]);
    expect(await resolveSession(token)).toBeNull();
    await query("UPDATE accounts SET status = 'ACTIVE' WHERE id = $1", [owner!.id]);
    await revokeSession(token);
    expect(await resolveSession(token)).toBeNull();
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[owner!.id, stranger!.id]]);
    await pool().end();
  });
});
