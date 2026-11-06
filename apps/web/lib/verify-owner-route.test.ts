import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "./limits";
import { issueOwnerReportPdf, ownerPayloadOf } from "./owner-report-pdf";
import { buildPayload, sha256 } from "./report";
import { reportLabels } from "./report-labels";
import { ATTESTATION_KEY, issuePdf } from "./report-pdf";
import { signingKey } from "./report-signer";

/** /api/verify tells the owner PDF from the compliance PDF by the payload's schema id (verikora#481). Only database edges are faked. */
const MEMBER = { id: "22222222-2222-4222-8222-222222222222", email: "guest@example.test" };
const state = vi.hoisted(() => ({ audits: [] as Record<string, unknown>[] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => ({ account: MEMBER }),
}));
vi.mock("./audit", () => ({ audit: async (entry: Record<string, unknown>) => void state.audits.push(entry) }));
vi.mock("./report-access", async (orig) => ({
  ...(await orig<typeof import("./report-access")>()),
  loadTarget: async () => null,
}));
vi.mock("./db", () => ({ query: async () => [] }));

const owner = {
  reference: "1A2B3C4D",
  issuedAt: "2026-10-27T12:00:00.000Z",
  expiresAt: "2026-11-03T12:00:00.000Z",
  candidateName: "Camille Fictif",
  documents: [
    {
      typeId: "pay-stub",
      sha256: "a".repeat(64),
      pages: 1,
      signals: [],
      findings: [{ ruleId: "R1", verdict: "PASS", severity: "BLOCKING", citation: null }],
      notExamined: [],
      runs: [],
    },
  ],
  rulesets: [],
};
const ownerPdf = (await issueOwnerReportPdf(ownerPayloadOf(owner as never, "en"), signingKey())).bytes;
const doc = { sha256: sha256("lease"), filename: "bail.pdf", title: "Bail", sizeBytes: 5, pages: 1 };
const analysis = {
  id: "a1",
  studio: "compliance-check" as const,
  status: "succeeded" as const,
  runId: "run-9",
  blueprintVersion: "1",
  inputs: {},
  report: { rulesetId: "qc", rulesetVersion: "1", jurisdiction: "QC", asOf: "2026-10-14", findings: [] },
  error: null,
  createdAt: "2026-10-14T10:00:00.000Z",
  finishedAt: "2026-10-14T10:00:05.000Z",
};

const post = async (bytes: Uint8Array) => {
  const { POST } = await import("../app/api/verify/route");
  const form = new FormData();
  form.set("report", new File([bytes as BlobPart], "report.pdf", { type: "application/pdf" }));
  return POST(
    new Request("https://dev.verikora.com/api/verify", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  );
};
const withSchema = async (bytes: Uint8Array, change: (a: Record<string, unknown>) => void) => {
  const d = await PDFDocument.load(bytes, { updateMetadata: false });
  const info = d.context.lookup(d.context.trailerInfo.Info, PDFDict);
  const att = JSON.parse(
    Buffer.from((info.get(PDFName.of(ATTESTATION_KEY)) as PDFString).asString(), "base64").toString("utf8"),
  );
  change(att);
  info.set(PDFName.of(ATTESTATION_KEY), PDFString.of(Buffer.from(JSON.stringify(att)).toString("base64")));
  return d.save({ useObjectStreams: false });
};

beforeEach(() => {
  resetRateLimits();
  state.audits = [];
});

describe("POST /api/verify — dispatch on the schema id", () => {
  it("verifies an owner PDF and shows only its public facts", async () => {
    const res = await post(ownerPdf);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({
      kind: "owner-report",
      ok: true,
      issuedAt: owner.issuedAt,
      expiresAt: owner.expiresAt,
      summary: { documents: 1, findings: { PASS: 1 } },
    });
    expect(JSON.stringify(body)).not.toMatch(/Camille|1A2B3C4D|pay-stub/);
  });

  it("fails a tampered owner PDF", async () => {
    const res = await post(
      await withSchema(ownerPdf, (a) => ((a.payload as { reference: string }).reference = "FFFFFFFF")),
    );
    expect((await res.json()).result).toMatchObject({ kind: "owner-report", ok: false, reason: "BAD_SIGNATURE" });
  });

  it("still verifies a compliance PDF through the compliance path", async () => {
    const issued = await issuePdf(buildPayload(doc, analysis, "en"), reportLabels("en"), signingKey());
    const res = await post(issued.bytes);
    expect(res.status).toBe(403); // the compliance rules of ADR-0002 still apply: no grant, no answer
    expect((await res.json()).code).toBe("NO_ACCESS");
  });

  it("refuses an unknown schema", async () => {
    const res = await post(await withSchema(ownerPdf, (a) => (a.schema = "verikora.other/9")));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("UNKNOWN_SCHEMA");
  });
});
