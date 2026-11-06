import { beforeAll, describe, expect, it } from "vitest";

import { listChecks } from "./checks";
import { migrate, query } from "./db";

/** The Vérifications list against a real PostgreSQL: every check of the owner, newest first, with the result the library's words give it. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the list of checks (Vérifications)", () => {
  beforeAll(async () => {
    await migrate();
  });

  const account = async () =>
    (
      await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [
        `checks-${Math.random().toString(36).slice(2)}@example.test`,
      ])
    )[0]!.id;
  const document = async (owner: string, title: string, kind: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, pages, content, text) VALUES ($1, $2, $3, 'application/pdf', $4, 3, $5, 1, $6, 'texte') RETURNING id",
        [
          owner,
          title,
          `${title}.pdf`,
          kind,
          Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64),
          Buffer.from("pdf"),
        ],
      )
    )[0]!.id;
  const analysis = (
    documentId: string,
    studio: string,
    status: string,
    attention: boolean | null,
    at: string,
    runId: string | null,
  ) =>
    query(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, created_at, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        documentId,
        studio,
        status,
        runId,
        attention === null ? null : JSON.stringify({ attention }),
        at,
        status === "running" ? null : at,
      ],
    );

  it("lists every check of the owner, newest first, each with its document, its run and its result — and nothing of anyone else", async () => {
    const owner = await account();
    const lease = await document(owner, "Bail — Rosemont, logement 5", "lease");
    const invoice = await document(owner, "Facture 2026-04", "invoice");
    await analysis(lease, "compliance-check", "succeeded", true, "2026-10-21T10:00:00Z", "run_lease");
    await analysis(invoice, "document-authenticity", "succeeded", false, "2026-10-22T10:00:00Z", "run_invoice");
    await analysis(lease, "compliance-check", "failed", null, "2026-10-20T10:00:00Z", "run_failed");
    await analysis(invoice, "document-authenticity", "running", null, "2026-10-23T10:00:00Z", null);
    const other = await account();
    await analysis(
      await document(other, "Ailleurs", "other"),
      "compliance-check",
      "succeeded",
      false,
      "2026-10-23T12:00:00Z",
      "run_other",
    );

    const checks = await listChecks(query, owner);
    expect(checks.map((c) => [c.title, c.studio, c.result, c.runId])).toEqual([
      ["Facture 2026-04", "document-authenticity", "analysing", null],
      ["Facture 2026-04", "document-authenticity", "checked", "run_invoice"],
      ["Bail — Rosemont, logement 5", "compliance-check", "attention", "run_lease"],
      ["Bail — Rosemont, logement 5", "compliance-check", "failed", "run_failed"],
    ]);
    expect(checks[0]!.documentId).toBe(invoice);
    expect(checks[2]!.kind).toBe("lease");
    expect(checks[1]!.at).toBe("2026-10-22T10:00:00.000Z");
    expect(await listChecks(query, "00000000-0000-0000-0000-000000000000")).toEqual([]);
    expect(await listChecks(query, owner, 2)).toHaveLength(2);
  });

  it("reads the same order on every run when two checks finished at the very same instant (#641: a tie must not decide)", async () => {
    const owner = await account();
    const b = await document(owner, "B — second by title", "lease");
    const a = await document(owner, "A — first by title", "lease");
    await analysis(b, "compliance-check", "succeeded", false, "2026-10-21T10:00:00Z", "run_b");
    await analysis(a, "compliance-check", "succeeded", false, "2026-10-21T10:00:00Z", "run_a");
    const first = (await listChecks(query, owner)).map((c) => c.title);
    for (let i = 0; i < 5; i++) {
      expect((await listChecks(query, owner)).map((c) => c.title)).toEqual(first);
    }
    expect(first).toEqual(["A — first by title", "B — second by title"]);
  });
});
