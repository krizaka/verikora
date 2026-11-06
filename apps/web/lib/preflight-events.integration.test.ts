import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "./db";
import { findReusableAnalysis, preflightMetrics, recordPreflight } from "./preflight-events";

/** Reuse and metrics against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("pre-flight: reuse and metrics", () => {
  // The newest Studio version in force is the newest row: each case takes a fresh, larger one (a shared test database keeps history).
  let tick = Date.now();
  const version = () => `v${++tick}`;
  beforeAll(async () => {
    await migrate();
  });
  const tenant = async () =>
    (
      await query<{ id: string }>("INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') RETURNING id", [
        `p-${Math.random().toString(36).slice(2)}@verikora.test`,
      ])
    )[0]!.id;
  const document = async (owner: string, sha: string) =>
    (
      await query<{ id: string }>(
        "INSERT INTO documents (owner_id, title, filename, mime_type, size_bytes, sha256, content, text) VALUES ($1, 't', 'a.txt', 'text/plain', 1, $2, 'x', 'x') RETURNING id",
        [owner, sha],
      )
    )[0]!.id;
  const run = async (doc: string, version: string, inputs: object, status = "succeeded") =>
    (
      await query<{ id: string }>(
        "INSERT INTO analyses (document_id, studio, status, run_id, blueprint_version, inputs) VALUES ($1, 'compliance-check', $2, $3, $4, $5) RETURNING id",
        [doc, status, `run-${Math.random()}`, version, JSON.stringify(inputs)],
      )
    )[0]!.id;
  const ask = (
    owner: string,
    documentId: string,
    over: Partial<{ jurisdiction: string; ruleset: string | null }> = {},
  ) =>
    findReusableAnalysis(query, {
      reuseDays: 365,
      now: new Date(),
      ownerId: owner,
      documentId,
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: null,
      expectedIssuer: null,
      ...over,
    });

  it("reuses a succeeded run of the same document, rules and Studio version — no new run", async () => {
    const o = await tenant();
    const d = await document(o, `s-${o}`);
    const v = version();
    const first = await run(d, v, { jurisdiction: "QC" });
    expect(await ask(o, d)).toBe(first);
  });
  it("does not reuse across other rules, another Studio version, a failed run, or another tenant", async () => {
    const o = await tenant();
    const d = await document(o, `s2-${o}`);
    const v = version();
    await run(d, v, { jurisdiction: "QC" }, "failed");
    expect(await ask(o, d)).toBeNull(); // only a failed run
    const ok = await run(d, v, { jurisdiction: "QC" });
    expect(await ask(o, d, { ruleset: "qc-invoice" })).toBeNull(); // other rules
    expect(await ask(o, d, { jurisdiction: "FR" })).toBeNull();
    const other = await tenant();
    expect(await ask(other, d)).toBeNull(); // another tenant never sees it
    await run(d, version(), { jurisdiction: "QC" }, "running"); // the Studio moved on: a newer version is now in force
    expect(await ask(o, d)).toBeNull();
    expect(ok).toBeTruthy();
  });
  it("a purged document is never reused (its analyses go with it)", async () => {
    const o = await tenant();
    const d = await document(o, `s3-${o}`);
    await run(d, version(), { jurisdiction: "QC" });
    await query("DELETE FROM documents WHERE id = $1", [d]);
    expect(await ask(o, d)).toBeNull();
  });
  it("counts the runs avoided per tenant, with an estimated saving", async () => {
    const o = await tenant();
    await recordPreflight(query, o, "accepted");
    await recordPreflight(query, o, "rejected", "ENCRYPTED");
    await recordPreflight(query, o, "rejected", "CORRUPT");
    await recordPreflight(query, o, "reused");
    const mine = (await preflightMetrics(query, 3)).find((m) => m.tenantId === o);
    expect(mine).toMatchObject({ accepted: 1, rejected: 2, reused: 1, runsAvoided: 3, estimatedSavedCents: 9 });
  });

  it("reuse is a setting: switched off (0 days) nothing is reused, and a run older than the window is not", async () => {
    const o = await tenant();
    const d = await document(o, `w-${o}`);
    const id = await run(d, "1.2.0", { jurisdiction: "QC" });
    const base = {
      ownerId: o,
      documentId: d,
      studio: "compliance-check",
      jurisdiction: "QC",
      ruleset: null,
      expectedIssuer: null,
      now: new Date(),
    };
    expect(await findReusableAnalysis(query, { ...base, reuseDays: 365 })).toBe(id);
    expect(await findReusableAnalysis(query, { ...base, reuseDays: 0 })).toBeNull();
    // The Studio version in force is the newest run's: keep it this one while the run under test ages.
    await run(await document(o, `w2-${o}`), "1.2.0", { jurisdiction: "FR" });
    await query("UPDATE analyses SET created_at = now() - interval '40 days' WHERE id = $1", [id]);
    expect(await findReusableAnalysis(query, { ...base, reuseDays: 30 })).toBeNull();
    expect(await findReusableAnalysis(query, { ...base, reuseDays: 60 })).toBe(id);
  });
});
