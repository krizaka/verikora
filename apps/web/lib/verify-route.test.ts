import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "./limits";
import { buildPayload, issueReport, sha256 } from "./report";
import type { Grant, Target } from "./report-access";
import { reportLabels } from "./report-labels";
import { issuePdf } from "./report-pdf";
import { signingKey } from "./report-signer";

/**
 * ADR-0002 — verifying a report is for members the owner gave access to. The route's whole chain runs for real (session
 * gate, reference, access rule, signature check, audit); only the database edges are faked: the session, the report
 * lookup and the audit sink.
 */
const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" };
const GUEST = { id: "22222222-2222-4222-8222-222222222222", email: "guest@example.test" };

const state = vi.hoisted(() => ({
  session: null as null | { account: { id: string; email: string } },
  target: null as unknown,
  audits: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("./session", async (orig) => ({
  ...(await orig<typeof import("./session")>()),
  resolveSession: async () => state.session,
}));
vi.mock("./audit", () => ({ audit: async (entry: Record<string, unknown>) => void state.audits.push(entry) }));
vi.mock("./report-access", async (orig) => ({
  ...(await orig<typeof import("./report-access")>()),
  loadTarget: async () => state.target,
}));
vi.mock("./db", () => ({ query: async () => [] }));

const doc = { sha256: sha256("lease bytes"), filename: "bail.pdf", title: "Bail", sizeBytes: 11, pages: 1 };
const analysis = {
  id: "a1",
  studio: "compliance-check" as const,
  status: "succeeded" as const,
  runId: "run-123",
  blueprintVersion: "1.0.0",
  inputs: {},
  report: {
    rulesetId: "qc",
    rulesetVersion: "1",
    jurisdiction: "QC",
    asOf: "2026-10-14",
    findings: [{ ruleId: "r1", severity: "BLOCKING", verdict: "FAIL", explanation: "x", evidenceSpan: { quote: "q" } }],
  },
  error: null,
  createdAt: "2026-10-14T10:00:00.000Z",
  finishedAt: "2026-10-14T10:00:05.000Z",
};
const issued = issueReport(buildPayload(doc, analysis, "en"), reportLabels("en"), signingKey());

const pdfIssued = await issuePdf(buildPayload(doc, analysis, "en"), reportLabels("en"), signingKey());

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: "g1",
  email: GUEST.email,
  createdAt: new Date("2026-10-01"),
  expiresAt: null,
  revokedAt: null,
  ...over,
});
const held = (grants: Grant[]): Target => ({ analysisId: "an-1", documentId: "doc-1", ownerId: OWNER.id, grants });

const post = async (html = issued.html) => {
  const { POST } = await import("../app/api/verify/route");
  const form = new FormData();
  form.set("report", new File([html], "report.html", { type: "text/html" }));
  return POST(
    new Request("https://dev.verikora.com/api/verify", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  );
};

beforeEach(() => {
  resetRateLimits();
  state.session = null;
  state.target = null;
  state.audits = [];
});

describe("POST /api/verify — members only, by grant", () => {
  it("answers 401 to a signed-out caller, whatever it sends — the old public path is closed", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("<html></html>")).status).toBe(401);
    expect(state.audits).toEqual([]);
  });

  it("answers 403 NO_ACCESS to a member with no grant, and offers to request access", async () => {
    state.session = { account: GUEST };
    state.target = held([]);
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "NO_ACCESS", requestable: true, runId: "run-123" });
  });

  it("answers the same 403 for a report this server does not hold (nothing to learn about what exists)", async () => {
    state.session = { account: GUEST };
    state.target = null;
    expect((await post()).status).toBe(403);
  });

  it("answers 200 with the full check to a member holding a live grant", async () => {
    state.session = { account: GUEST };
    state.target = held([grant()]);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      result: { ok: true, fileSha256: issued.fileSha256, payload: { check: { runId: "run-123" } } },
    });
  });

  it("answers 200 to the owner without any grant", async () => {
    state.session = { account: OWNER };
    state.target = held([]);
    expect((await post()).status).toBe(200);
  });

  it("matches the grant's e-mail whatever its case", async () => {
    state.session = { account: { ...GUEST, email: "Guest@Example.Test" } };
    state.target = held([grant()]);
    expect((await post()).status).toBe(200);
  });

  it("answers 403 once the grant is revoked", async () => {
    state.session = { account: GUEST };
    state.target = held([grant({ revokedAt: new Date("2026-10-02") })]);
    expect((await post()).status).toBe(403);
  });

  it("answers 403 once the grant has expired, and 200 while its date is ahead", async () => {
    state.session = { account: GUEST };
    state.target = held([grant({ expiresAt: new Date("2020-01-01") })]);
    expect((await post()).status).toBe(403);
    state.target = held([grant({ expiresAt: new Date(Date.now() + 86_400_000) })]);
    expect((await post()).status).toBe(200);
  });

  it("does not let another person's grant open the report", async () => {
    state.session = { account: GUEST };
    state.target = held([grant({ email: "someone-else@example.test" })]);
    expect((await post()).status).toBe(403);
  });

  it("still fails a tampered report for a member with access — the signature is the second lock", async () => {
    state.session = { account: GUEST };
    state.target = held([grant()]);
    const res = await post(issued.html.replace("Bail", "Bail 2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { ok: false, reason: "ALTERED" } });
  });

  it("turns a file that is not a report into NOT_A_REPORT without touching the grants", async () => {
    state.session = { account: GUEST };
    const res = await post("<html></html>");
    expect(await res.json()).toMatchObject({ result: { ok: false, reason: "NOT_A_REPORT" } });
  });

  it("refuses a body over the cap with 413 before reading it", async () => {
    state.session = { account: GUEST };
    const { POST } = await import("../app/api/verify/route");
    const res = await POST(
      new Request("https://dev.verikora.com/api/verify", {
        method: "POST",
        body: "x",
        headers: { "content-length": String(13 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" },
      }),
    );
    expect(res.status).toBe(413);
  });

  it("is limited per account: the 61st attempt in ten minutes is 429", async () => {
    state.session = { account: GUEST };
    state.target = held([grant()]);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post()).status;
    expect(last).toBe(429);
  });
});

describe("the audit trail — who verified what, and when", () => {
  it("writes report.verified with the actor, the run, the way in (grant) and the outcome", async () => {
    state.session = { account: GUEST };
    state.target = held([grant()]);
    await post();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      action: "report.verified",
      actorId: GUEST.id,
      actorLabel: GUEST.email,
      targetId: "an-1",
      detail: { runId: "run-123", ok: true, via: "grant", grantId: "g1", fileSha256: issued.fileSha256 },
    });
  });

  it("records the owner's own check as via: owner", async () => {
    state.session = { account: OWNER };
    state.target = held([]);
    await post();
    expect(state.audits[0]).toMatchObject({ action: "report.verified", detail: { via: "owner" } });
  });

  it("writes report.verify_denied for a refusal", async () => {
    state.session = { account: GUEST };
    state.target = held([]);
    await post();
    expect(state.audits[0]).toMatchObject({
      action: "report.verify_denied",
      actorId: GUEST.id,
      detail: { runId: "run-123", known: true },
    });
  });
});

const postPdf = async (bytes: Uint8Array = pdfIssued.bytes) => {
  const { POST } = await import("../app/api/verify/route");
  const form = new FormData();
  form.set("report", new File([new Uint8Array(bytes)], "report.pdf", { type: "application/pdf" }));
  return POST(
    new Request("https://dev.verikora.com/api/verify", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.9" },
    }),
  );
};

describe("POST /api/verify — a signed PDF report follows the same rules as the HTML one", () => {
  it("401 signed out, 403 without a grant, 200 with a grant or as the owner, 403 once revoked", async () => {
    expect((await postPdf()).status).toBe(401);
    state.session = { account: GUEST };
    state.target = held([]);
    const denied = await postPdf();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "NO_ACCESS", runId: "run-123" });
    state.target = held([grant()]);
    const ok = await postPdf();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ result: { ok: true, payload: { check: { runId: "run-123" } } } });
    state.target = held([grant({ revokedAt: new Date("2026-10-02") })]);
    expect((await postPdf()).status).toBe(403);
    state.session = { account: OWNER };
    state.target = held([]);
    expect((await postPdf()).status).toBe(200);
  });

  it("audits a PDF verification like any other", async () => {
    state.session = { account: GUEST };
    state.target = held([grant()]);
    await postPdf();
    expect(state.audits[0]).toMatchObject({
      action: "report.verified",
      detail: { runId: "run-123", ok: true, via: "grant" },
    });
  });

  it("a PDF with no attestation is a failed check, not a crash, and reveals nothing", async () => {
    state.session = { account: GUEST };
    const { PDFDocument } = await import("pdf-lib");
    const res = await postPdf(await (await PDFDocument.create()).save());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: { ok: false, reason: "UNREADABLE" } });
  });
});
