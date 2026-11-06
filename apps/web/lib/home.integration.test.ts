import { beforeAll, describe, expect, it } from "vitest";

import { readCheckFilters } from "./check-filters";
import { listChecks } from "./checks";
import { migrate, query } from "./db";
import { activity, activityStrip, filesToDecide, toDo } from "./home";
import { toDoLinks } from "./home-figures";

/** The home's figures against a real PostgreSQL (verikora#325): each one counted over the rows its view lists. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the home's figures", () => {
  beforeAll(async () => {
    await migrate();
  });

  const account = async () =>
    (
      await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [
        `home-${Math.random().toString(36).slice(2)}@example.test`,
      ])
    )[0]!.id;
  const document = async (owner: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, pages, content, text) VALUES ($1, 'Bail', 'bail.pdf', 'application/pdf', 'lease', 3, $2, 1, $3, 'texte') RETURNING id",
        [owner, Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64), Buffer.from("pdf")],
      )
    )[0]!.id;
  const analysis = (documentId: string, status: string, attention: boolean | null, at: string) =>
    query(
      "INSERT INTO analyses (document_id, studio, status, run_id, report, created_at, finished_at) VALUES ($1, 'compliance-check', $2, $3, $4, $5, $6)",
      [
        documentId,
        status,
        `run_${Math.random().toString(36).slice(2)}`,
        attention === null ? null : JSON.stringify({ attention }),
        at,
        status === "running" ? null : at,
      ],
    );
  const file = (owner: string, patch: { expires: string; submitted?: string; closed?: string }) =>
    query(
      "INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, flow, requested_types, submitted_at, closed_at) VALUES ($1, 'Camille', 'camille@example.test', '{}', 'applicant-file', $2, $3, 'file', '{pay-stub}', $4, $5)",
      [owner, Math.random().toString(16).slice(2), patch.expires, patch.submitted ?? null, patch.closed ?? null],
    );
  const NOW = new Date("2026-10-24T16:00:00Z");

  it("counts the checks to look at as the rows Vérifications shows under its filter — and nothing of anyone else", async () => {
    const owner = await account();
    const doc = await document(owner);
    await analysis(doc, "succeeded", true, "2026-10-20T10:00:00Z");
    await analysis(doc, "failed", null, "2026-10-21T10:00:00Z");
    await analysis(doc, "cancelled", null, "2026-10-21T11:00:00Z");
    await analysis(doc, "succeeded", false, "2026-10-22T10:00:00Z");
    await analysis(doc, "running", null, "2026-10-24T10:00:00Z");
    await analysis(await document(await account()), "failed", null, "2026-10-22T10:00:00Z");
    const figures = await toDo(query, owner, NOW, { applicantFiles: false });
    const filter = readCheckFilters(new URL(toDoLinks("fr").toReview, "https://x.test").search);
    const shown = (await listChecks(query, owner)).filter((c) => filter.result.includes(c.result));
    expect(figures).toEqual({ toReview: 3, toDecide: null, openLinks: null, nextExpiry: null });
    expect(shown).toHaveLength(figures.toReview);
  });

  it("counts the files to decide (sent, not closed) and the open links, with the first expiry", async () => {
    const owner = await account();
    await file(owner, { expires: "2026-11-07T12:00:00Z" });
    await file(owner, { expires: "2026-11-02T12:00:00Z" });
    await file(owner, { expires: "2026-11-01T12:00:00Z", submitted: "2026-10-23T12:00:00Z" });
    await file(owner, {
      expires: "2026-11-01T12:00:00Z",
      submitted: "2026-10-22T12:00:00Z",
      closed: "2026-10-23T12:00:00Z",
    });
    await file(owner, { expires: "2026-10-20T12:00:00Z" });
    expect(await toDo(query, owner, NOW, { applicantFiles: true })).toEqual({
      toReview: 0,
      toDecide: 1,
      openLinks: 2,
      nextExpiry: "2026-11-02T12:00:00.000Z",
    });
  });

  it("counts the rail's badge by one query, as the home's « Dossiers à décider », and only the account's own files", async () => {
    const owner = await account();
    await file(owner, { expires: "2026-11-07T12:00:00Z" });
    await file(owner, { expires: "2026-11-01T12:00:00Z", submitted: "2026-10-23T12:00:00Z" });
    await file(owner, { expires: "2026-11-01T12:00:00Z", submitted: "2026-10-23T12:00:00Z" });
    await file(owner, {
      expires: "2026-11-01T12:00:00Z",
      submitted: "2026-10-22T12:00:00Z",
      closed: "2026-10-23T12:00:00Z",
    });
    await file(owner, { expires: "2026-10-20T12:00:00Z", submitted: "2026-10-19T12:00:00Z" });
    await file(await account(), { expires: "2026-11-01T12:00:00Z", submitted: "2026-10-23T12:00:00Z" });
    expect(await filesToDecide(query, owner, NOW)).toBe(2);
    expect((await toDo(query, owner, NOW, { applicantFiles: true })).toDecide).toBe(2);
    expect(await filesToDecide(query, await account(), NOW)).toBe(0);
  });

  it("counts the checks of each day of the period in Québec, none before it", async () => {
    const owner = await account();
    const doc = await document(owner);
    await analysis(doc, "succeeded", false, "2026-10-24T12:00:00Z");
    await analysis(doc, "succeeded", false, "2026-10-24T02:00:00Z"); // the 23rd in Québec
    await analysis(doc, "failed", null, "2026-10-01T12:00:00Z");
    const days = await activity(query, owner, "7d", NOW);
    expect(days).toHaveLength(7);
    expect(days.slice(-2)).toEqual([
      { day: "2026-10-23", checks: 1 },
      { day: "2026-10-24", checks: 1 },
    ]);
    expect(days.reduce((n, d) => n + d.checks, 0)).toBe(2);
  });

  it("the strip's four figures are queries over the chosen period, the owner's own rows only (verikora#332)", async () => {
    const owner = await account();
    const doc = await document(owner);
    await query("UPDATE documents SET created_at = $2 WHERE id = $1", [doc, "2026-10-23T12:00:00Z"]);
    await analysis(doc, "succeeded", true, "2026-10-24T12:00:00Z"); // to look at, in the 7 days
    await analysis(doc, "succeeded", false, "2026-10-23T12:00:00Z");
    await analysis(doc, "failed", null, "2026-10-10T12:00:00Z"); // in the 30 days, not the 7
    await analysis(await document(await account()), "succeeded", true, "2026-10-24T12:00:00Z");
    await file(owner, { expires: "2026-11-07T12:00:00Z", submitted: "2026-10-22T12:00:00Z" });
    await file(owner, { expires: "2026-11-07T12:00:00Z" }); // never sent
    const sum = (days: { checks: number }[] | null) => (days ?? []).reduce((n, d) => n + d.checks, 0);
    const week = await activityStrip(query, owner, "7d", NOW, { applicantFiles: true });
    expect([sum(week.checks), sum(week.toReview), sum(week.files)]).toEqual([2, 1, 1]);
    const month = await activityStrip(query, owner, "30d", NOW, { applicantFiles: true });
    expect([sum(month.checks), sum(month.toReview)]).toEqual([3, 2]);
    expect(sum(month.documents)).toBe(1);
    expect((await activityStrip(query, owner, "7d", NOW, { applicantFiles: false })).files).toBeNull();
  });
});
