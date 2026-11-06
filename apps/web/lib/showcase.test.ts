import { readFileSync } from "node:fs";

import { reportOf } from "@verikora/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: { text: string; values: unknown[] }[] = [];
let answers: unknown[][] = [];
vi.mock("./db", () => ({
  query: vi.fn(async (text: string, values: unknown[] = []) => {
    queries.push({ text, values });
    return answers.shift() ?? [];
  }),
}));
vi.mock("./audit", () => ({ audit: vi.fn(async () => undefined) }));

import { audit } from "./audit";
import { SAMPLE_LEASE } from "./sample-lease";
import { getShowcase, getShowcaseView, setSample, setShowcase, SHOWCASE_SQL, showcaseFile } from "./showcase";

// A real Sovkora compliance report (blueprint 1.2.0, jurisdiction Québec, nine findings), as the showcase row holds it.
const REPORT = reportOf("compliance-check", [
  {
    key: "report",
    type: "JSON",
    value: readFileSync(new URL("./fixtures/sovkora-compliance-qc-1.2.0.json", import.meta.url), "utf8"),
  },
])!;
const ID = "7d3f6a52-2f3a-4d44-9a0e-1b7f6f6c2a10";
const RUN = "de62fe0d-16ec-44c6-8b32-751607e17cdf";
const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  studio: "compliance-check",
  status: "succeeded",
  run_id: RUN,
  blueprint_version: "1.2.0",
  inputs: {},
  report: REPORT,
  error: null,
  created_at: new Date("2026-10-15T06:00:00Z"),
  finished_at: new Date("2026-10-15T06:01:00Z"),
  d_title: "Bail Montréal",
  d_filename: "bail.pdf",
  d_sha256: "a".repeat(64),
  d_size_bytes: 1200,
  d_pages: 1,
  d_text: SAMPLE_LEASE,
  d_mime_type: "application/pdf",
  ...over,
});
const actor = { id: "11111111-1111-4111-8111-111111111111", email: "admin@verikora.test" };

beforeEach(() => {
  queries.length = 0;
  answers = [];
  vi.mocked(audit).mockClear();
});

describe("what the public can see", () => {
  it("is read only through a query that requires BOTH the showcase flag and the sample flag", () => {
    expect(SHOWCASE_SQL).toMatch(
      /WHERE a\.showcase AND d\.sample AND a\.studio = 'compliance-check' AND a\.status = 'succeeded'/,
    );
    expect(SHOWCASE_SQL).toMatch(/LIMIT 1/);
  });

  it("answers null — never a guess — when nothing is promoted", async () => {
    expect(await getShowcase()).toBeNull();
    expect(await getShowcaseView()).toBeNull();
  });

  it("answers the promoted check: run id, Studio version, the report as Sovkora returned it", async () => {
    answers = [[row()]];
    const showcase = await getShowcase();
    expect(showcase).toMatchObject({ runId: RUN, studioVersion: "1.2.0", document: { sha256: "a".repeat(64) } });
    expect(showcase?.report.findings).toHaveLength(9);
  });

  it("refuses a report it cannot read rather than showing part of it", async () => {
    answers = [[row({ report: { oops: true } })]];
    expect(await getShowcase()).toBeNull();
  });

  it("serves the sample's file only through the same guard, with no id to ask for", async () => {
    answers = [[{ filename: "bail.pdf", mime_type: "application/pdf", content: Buffer.from("%PDF") }]];
    expect(await showcaseFile()).toMatchObject({ filename: "bail.pdf" });
    expect(queries[0]!.text).toContain("d.sample");
    expect(queries[0]!.text).toContain("a.showcase AND d.sample");
    expect(queries[0]!.values).toEqual([]);
  });

  it("has no signed report to issue: the public showcase module exports no signing function (ADR-0002)", async () => {
    const mod = await import("./showcase");
    expect(Object.keys(mod).filter((k) => /report/i.test(k))).toEqual([]);
  });
});

describe("what an administrator may promote", () => {
  it("refuses a check on a document that is not a sample (a personal document can never be flagged)", async () => {
    answers = [[{ id: ID, sample: false, studio: "compliance-check", status: "succeeded" }]];
    await expect(setShowcase(actor, ID, true)).rejects.toMatchObject({ status: 409, body: { code: "NOT_A_SAMPLE" } });
    expect(queries.some((q) => /showcase = true/.test(q.text))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a check that is not a finished compliance check", async () => {
    answers = [[{ id: ID, sample: true, studio: "document-authenticity", status: "succeeded" }]];
    await expect(setShowcase(actor, ID, true)).rejects.toMatchObject({ status: 409, body: { code: "NOT_SHOWABLE" } });
    answers = [[{ id: ID, sample: true, studio: "compliance-check", status: "running" }]];
    await expect(setShowcase(actor, ID, true)).rejects.toMatchObject({ status: 409, body: { code: "NOT_SHOWABLE" } });
  });

  it("promotes one check, replaces the previous one in the same statement, and audit-logs it", async () => {
    answers = [[{ id: ID, sample: true, studio: "compliance-check", status: "succeeded" }]];
    await expect(setShowcase(actor, ID, true)).resolves.toEqual({ id: ID, showcase: true });
    const last = queries.at(-1)!;
    expect(last.text).toMatch(/showcase = false WHERE showcase AND id <> \$1/);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.showcase_set", actorLabel: actor.email, targetId: ID }),
    );
  });

  it("withdraws a check, and unmarking a sample withdraws its checks too", async () => {
    answers = [[{ id: ID }]];
    await setShowcase(actor, ID, false);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "admin.showcase_unset" }));
    answers = [[{ id: ID }]];
    await setSample(actor, ID, false);
    expect(queries.at(-1)!.text).toContain("SET showcase = false WHERE document_id = $1");
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "admin.document_sample_unset" }));
  });

  it("rejects ids that are not uuids before touching the database", async () => {
    await expect(setShowcase(actor, "x", true)).rejects.toMatchObject({ status: 404 });
    await expect(setSample(actor, "x", true)).rejects.toMatchObject({ status: 404 });
    expect(queries).toHaveLength(0);
  });
});
