import { beforeAll, describe, expect, it } from "vitest";

import { seedAudits } from "../audit-credits.testkit";
import { migrate, query } from "../db";
import { storeDocument } from "../documents";
import { cleanPdf, javascriptPdf } from "../preflight/fixtures";
import { settingsFor } from "../settings/guards";
import { previewBatch } from "./preview";

/** A batch's preview against the real pre-flight, reuse rule and PostgreSQL (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…). Nothing is stored by it. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("the preview of a batch (yomizaka#232)", () => {
  let owner = "";
  const pdf = (name: string, bytes: Uint8Array) => ({ name, type: "application/pdf", bytes });
  beforeAll(async () => {
    await migrate();
    const [row] = await query<{ id: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [`batch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@yomizaka.test`]);
    owner = row!.id;
  });

  it("says row by row what would run, what is refused and why, and the audits it costs — storing nothing", async () => {
    const before = (await query<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE owner_id = $1", [owner]))[0]!.n;
    const manifest = ["file,check,reference", "bail.pdf,compliance,LOC-1", "bail.pdf,authenticity,LOC-1", "absent.pdf,compliance,LOC-2", "bail.pdf,audit,LOC-3", "piege.pdf,compliance,LOC-4"].join("\n");
    const preview = await previewBatch(owner, manifest, [pdf("bail.pdf", await cleanPdf()), pdf("piege.pdf", await javascriptPdf()), pdf("extra.pdf", await cleanPdf("autre"))], await settingsFor(owner), new Date());
    expect(preview.rows.map((r) => [r.line, r.state, r.errors])).toEqual([
      [2, "check", []],
      [3, "check", []],
      [4, "refused", ["FILE_NOT_SENT"]],
      [5, "refused", ["UNKNOWN_CHECK"]],
      [6, "refused", ["FILE_ACTIVE_CONTENT"]],
    ]);
    expect(preview.unnamedFiles).toEqual(["extra.pdf"]);
    expect(preview.counts).toEqual({ check: 2, reuse: 0, refused: 3 });
    // A new account: the free first audit only, no credit — two checks are not covered yet.
    expect(preview.cost).toMatchObject({ audits: 2, covered: false, credits: 0, pro: false });
    expect((await query<{ n: number }>("SELECT count(*)::int AS n FROM documents WHERE owner_id = $1", [owner]))[0]!.n).toBe(before);
  });

  it("a file already checked with the same rules is reused: no audit for that row", async () => {
    const bytes = await cleanPdf("BAIL DÉJÀ VÉRIFIÉ");
    const { summary } = await storeDocument(owner, { name: "deja.pdf", type: "application/pdf", size: bytes.length }, bytes, "auto");
    await query("INSERT INTO analyses (document_id, studio, status, run_id, blueprint_version, inputs) VALUES ($1, 'compliance-check', 'succeeded', 'run-batch-1', '1.0.0', $2)", [summary.id, JSON.stringify({ jurisdiction: "QC" })]);
    await seedAudits(owner, { credits: 5 });
    const preview = await previewBatch(owner, "file,check\ndeja.pdf,compliance\nneuf.pdf,compliance", [pdf("deja.pdf", bytes), pdf("neuf.pdf", await cleanPdf("BAIL NEUF"))], await settingsFor(owner), new Date());
    expect(preview.rows.map((r) => r.state)).toEqual(["reuse", "check"]);
    expect(preview.cost).toMatchObject({ audits: 1, covered: true, credits: 5 });
  });

  it("a batch over the workspace's row limit is refused with the limit", async () => {
    const rows = ["file,check", ...Array.from({ length: 201 }, (_, i) => `f${i}.pdf,compliance`)].join("\n");
    await expect(previewBatch(owner, rows, [], await settingsFor(owner), new Date())).rejects.toMatchObject({ status: 413, body: { code: "BATCH_TOO_LARGE", limit: 200 } });
  });
});
