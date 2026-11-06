import fs from "node:fs";
import path from "node:path";

import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  issueOwnerReportPdf,
  ownerAttestationOfPdf,
  ownerPayloadOf,
  ownerReportBlocks,
  ownerReportPayload,
  verifyOwnerReportPdf,
} from "./owner-report-pdf";
import { ATTESTATION_KEY } from "./report-pdf";
import { signingKey } from "./report-signer";
import { VERDICT_WORDS } from "./signal-cards";

const state = vi.hoisted(() => ({ open: null as unknown, calls: [] as string[] }));
vi.mock("./owner-report-shares", () => ({
  openShare: async (token: string) => {
    state.calls.push(token);
    return token === "live-token" ? state.open : null;
  },
}));
vi.mock("./log", () => ({ logError: () => undefined, logInfo: () => undefined, logWarn: () => undefined }));

import { GET } from "../app/api/rapport/[token]/pdf/route";
import { resetRateLimits } from "./limits";

const SHA = "a".repeat(64);
// Extra properties a careless caller could pass along: they must never reach the PDF.
const report = {
  reference: "1A2B3C4D",
  issuedAt: "2026-10-27T12:00:00.000Z",
  expiresAt: "2026-11-03T12:00:00.000Z",
  candidateName: "Camille Fictif",
  candidateEmail: "camille@exemple.test",
  documents: [
    {
      typeId: "pay-stub",
      sha256: SHA,
      pages: 2,
      filename: "talon-camille.pdf",
      signals: [{ id: "s1", level: "INFO", observation: "Metadata consistent", quote: "Camille Fictif gagne 4 000 $" }],
      findings: [
        {
          ruleId: "QC-LEASE-004",
          verdict: "PASS",
          severity: "BLOCKING",
          citation: "C.c.Q., art. 1904",
          quote: "dépôt de sécurité",
        },
      ],
      notExamined: ["identity"],
      runs: [
        { studio: "authenticity", runId: "run-1", studioVersion: "1.0.0", finishedAt: "2026-10-27T11:00:00.000Z" },
      ],
    },
  ],
  rulesets: [
    {
      jurisdiction: "QC",
      rulesetId: "qc-residential-lease",
      rulesetVersion: "2024-02-21",
      reviewStatus: "TO_REVIEW_BY_LAWYER",
    },
  ],
};

const textOf = async (bytes: Uint8Array) => {
  const { extractText, getDocumentProxy } = await import("unpdf");
  return (
    (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true })).text as string
  ).replace(/\s+/g, " ");
};

describe("the owner report PDF (verikora#481)", () => {
  it.each(["en", "fr"] as const)("validates its schema, signs, and verifies in %s", async (lang) => {
    const payload = ownerPayloadOf(report as never, lang);
    expect(ownerReportPayload.safeParse(payload).success).toBe(true);
    expect(payload.expiresAt).toBe(report.expiresAt);
    const issued = await issueOwnerReportPdf(payload, signingKey());
    const verified = await verifyOwnerReportPdf(issued.bytes, signingKey());
    expect(verified).toMatchObject({ ok: true, keyId: signingKey().keyId });
    const text = await textOf(issued.bytes);
    expect(text).toContain("1A2B3C4D");
    expect(text).toContain(lang === "fr" ? "Rapport de vérification" : "Verification report");
    expect(text).not.toMatch(/certificat|authentique|certificate|authentic\b/i);
  });

  it.each(["en", "fr"] as const)(
    "carries the traces as cards — family, page, later save, ordinary explanations, what to ask for — and no verdict word, in %s",
    async (lang) => {
      const withTraces = {
        ...report,
        documents: [
          {
            ...report.documents[0],
            signals: [
              {
                id: "PDF-REV-002",
                level: "incohérent",
                observation: "Synthetic observation.",
                family: "history",
                evidence: { page: 2, revision: 2, field: "net" },
                box: [1, 2, 3, 4],
              },
              { id: "FILE-001", level: "observé", observation: "Synthetic cross observation." },
            ],
          },
        ],
      };
      const payload = ownerPayloadOf(withTraces as never, lang);
      expect(payload.documents[0]?.signals[0]?.evidence).toEqual({ page: 2, revision: 2, field: "net" });
      const text = ownerReportBlocks(payload)
        .map((x) => x.text)
        .join("\n");
      const w =
        lang === "fr"
          ? {
              page: "Page 2",
              ask: "Quoi demander",
              ordinary: "Explications ordinaires",
              family: "Historique du fichier",
            }
          : { page: "Page 2", ask: "What to ask for", ordinary: "Ordinary explanations", family: "File history" };
      for (const part of Object.values(w)) {
        expect(text).toContain(part);
      }
      expect(text.match(VERDICT_WORDS)).toBeNull();
      const pdf = await textOf((await issueOwnerReportPdf(payload, signingKey())).bytes);
      expect(pdf).toContain(w.page);
      expect(pdf.match(VERDICT_WORDS)).toBeNull();
      expect(JSON.stringify(payload)).not.toContain('"box"');
    },
  );

  it("is deterministic", async () => {
    const payload = ownerPayloadOf(report as never, "fr");
    expect((await issueOwnerReportPdf(payload, signingKey())).fileSha256).toBe(
      (await issueOwnerReportPdf(payload, signingKey())).fileSha256,
    );
  });

  it("carries no name, e-mail, file name or quoted text — in the payload, the attestation or the pages", async () => {
    const payload = ownerPayloadOf(report as never, "fr");
    const { bytes } = await issueOwnerReportPdf(payload, signingKey());
    const everything = `${await textOf(bytes)} ${JSON.stringify(await ownerAttestationOfPdf(bytes))}`;
    for (const pii of ["Camille", "exemple.test", "talon-camille", "gagne", "dépôt de sécurité", "4 000"]) {
      expect(everything).not.toContain(pii);
    }
    expect(ownerReportPayload.safeParse({ ...payload, candidateName: "Camille" }).success).toBe(false);
  });

  it("refuses a tampered payload, another key, and a non-report", async () => {
    const { bytes, attestation } = await issueOwnerReportPdf(ownerPayloadOf(report as never, "en"), signingKey());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const forged = { ...attestation, payload: { ...attestation.payload, reference: "FFFFFFFF" } };
    doc.context
      .lookup(doc.context.trailerInfo.Info, PDFDict)
      .set(PDFName.of(ATTESTATION_KEY), PDFString.of(Buffer.from(JSON.stringify(forged)).toString("base64")));
    expect(await verifyOwnerReportPdf(await doc.save({ useObjectStreams: false }), signingKey())).toMatchObject({
      ok: false,
      reason: "BAD_SIGNATURE",
    });
    expect(await verifyOwnerReportPdf(bytes, { ...signingKey(), keyId: "other" })).toMatchObject({
      ok: false,
      reason: "UNKNOWN_KEY",
    });
    expect(await verifyOwnerReportPdf(new TextEncoder().encode("hello world"), signingKey())).toMatchObject({
      ok: false,
      reason: "NOT_A_REPORT",
    });
  });

  it("flags a changed word on a page as ALTERED", async () => {
    const { bytes } = await issueOwnerReportPdf(ownerPayloadOf(report as never, "en"), signingKey());
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // The attestation of another report, glued to these pages: signature good, text not the signed one.
    const other = await issueOwnerReportPdf(
      ownerPayloadOf({ ...report, reference: "ZZZZZZZZ" } as never, "en"),
      signingKey(),
    );
    doc.context
      .lookup(doc.context.trailerInfo.Info, PDFDict)
      .set(
        PDFName.of(ATTESTATION_KEY),
        PDFString.of(Buffer.from(JSON.stringify(other.attestation)).toString("base64")),
      );
    expect(await verifyOwnerReportPdf(await doc.save({ useObjectStreams: false }), signingKey())).toMatchObject({
      ok: false,
      reason: "ALTERED",
    });
  });
});

describe("GET /api/rapport/<token>/pdf", () => {
  beforeEach(() => {
    resetRateLimits();
    state.calls = [];
    state.open = report;
  });
  const ask = (token: string, query = "") =>
    GET(
      new Request(`https://dev.verikora.com/api/rapport/${token}/pdf${query}`, {
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
      { params: Promise.resolve({ token }) },
    );

  it("delivers the signed PDF through the link (which records the opening) in the link's language", async () => {
    const res = await ask("live-token", "?locale=fr");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(await verifyOwnerReportPdf(bytes, signingKey())).toMatchObject({ ok: true, payload: { lang: "fr" } });
    expect(state.calls).toEqual(["live-token"]);
  });

  it("gives no PDF for an unknown, expired or revoked link (openShare answers null): 404", async () => {
    const res = await ask("expired-or-revoked-token");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toBe("application/pdf");
  });

  it("has no public specimen: the only route is the token's, and the payload has no specimen mode (ADR-0002)", () => {
    const root = path.join(__dirname, "../app/api/rapport");
    const files = fs.readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(files).toEqual([path.join("[token]", "pdf", "route.ts")]);
    expect(Object.keys(ownerReportPayload.shape)).not.toContain("specimen");
  });
});
