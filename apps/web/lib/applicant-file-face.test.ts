import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applicantLink,
  applicantRequest,
  askableTypes,
  checkFact,
  documentsFact,
  linkFact,
  requestableTypes,
} from "./applicant-file-face";
import { LINK, NOT_NECESSARY_TYPES } from "./applicant-file-rules";

const file = (
  status: (typeof LINK)[keyof typeof LINK],
  extra: Partial<{ submittedAt: string | null; closedAt: string | null }> = {},
) => ({ status, expiresAt: "2026-11-07T15:00:00.000Z", submittedAt: null, closedAt: null, ...extra });

describe("an applicant file's face (« Dossiers », P6, verikora#323)", () => {
  it("says the link's state in words, from linkState: open until a date, sent on a date, closed on a date, expired, revoked, erased", () => {
    expect(linkFact(file(LINK.open))).toEqual({
      key: "dossiers.link.open",
      date: "2026-11-07T15:00:00.000Z",
      tone: "accent",
    });
    expect(linkFact(file(LINK.used, { submittedAt: "2026-10-22T14:00:00.000Z" }))).toEqual({
      key: "dossiers.link.used",
      date: "2026-10-22T14:00:00.000Z",
      tone: "neutral",
    });
    expect(linkFact(file(LINK.closed, { closedAt: "2026-10-23T14:00:00.000Z" }))).toEqual({
      key: "dossiers.link.closed",
      date: "2026-10-23T14:00:00.000Z",
      tone: "neutral",
    });
    expect(linkFact(file(LINK.expired))).toMatchObject({ key: "dossiers.link.expired", tone: "neutral" });
    expect(linkFact(file(LINK.revoked))).toMatchObject({ key: "dossiers.link.revoked", tone: "neutral" });
    expect(linkFact(file(LINK.erased))).toMatchObject({ key: "dossiers.link.erased", tone: "neutral" });
  });

  it("counts the documents received against the documents asked", () => {
    expect(documentsFact(2, 3)).toEqual({ key: "dossiers.documents.some", count: 2, asked: 3 });
    expect(documentsFact(0, 2)).toEqual({ key: "dossiers.documents.none", count: 0, asked: 2 });
    expect(documentsFact(3, 3)).toEqual({ key: "dossiers.documents.all", count: 3, asked: 3 });
  });

  it("never offers a document the check does not need (the minimisation list), whatever the catalogue holds", () => {
    const catalogue = [{ id: "pay-stub" }, { id: "sin" }, { id: "bank-statement" }, { id: "void-cheque" }];
    expect(requestableTypes(catalogue).map((t) => t.id)).toEqual(["pay-stub", "bank-statement"]);
    expect(askableTypes({ "pay-stub": { label: "Talon de paie" } }, catalogue)).toEqual([
      { id: "pay-stub", label: "Talon de paie" },
      { id: "bank-statement", label: "bank-statement" },
    ]);
  });

  it("refuses a request for a SIN-like document before it leaves — the same rule the service applies", () => {
    const ok = { candidateName: "Camille Fictif", candidateEmail: "camille@example.test", types: ["pay-stub"] };
    expect(applicantRequest.safeParse(ok).success).toBe(true);
    for (const type of NOT_NECESSARY_TYPES)
      expect(applicantRequest.safeParse({ ...ok, types: ["pay-stub", type] }).success).toBe(false);
    expect(applicantRequest.safeParse({ ...ok, types: [] }).success).toBe(false);
    expect(applicantRequest.safeParse({ ...ok, candidateEmail: "pas une adresse" }).success).toBe(false);
  });

  it("says each check of a received document as Sovkora returned it: points to look at, signals, nothing found, running, failed", () => {
    const compliance = (findings: { verdict: string; severity: string }[]) => ({
      studio: "compliance-check",
      status: "succeeded",
      report: { findings, summary: null },
    });
    expect(
      checkFact(
        compliance([
          { verdict: "FAIL", severity: "BLOCKING" },
          { verdict: "PASS", severity: "INFO" },
        ]) as never,
      ),
    ).toEqual({ key: "dossiers.check.attention", count: 1, tone: "danger" });
    expect(checkFact(compliance([{ verdict: "PASS", severity: "INFO" }]) as never)).toEqual({
      key: "dossiers.check.nothing",
      count: 0,
      tone: "success",
    });
    const authenticity = (levels: string[]) => ({
      studio: "document-authenticity",
      status: "succeeded",
      report: { signals: levels.map((level, i) => ({ signalId: `s${i}`, level, observation: "" })) },
    });
    expect(checkFact(authenticity(["observé", "inhabituel", "incohérent"]) as never)).toEqual({
      key: "dossiers.check.signals",
      count: 2,
      tone: "warning",
    });
    expect(checkFact(authenticity(["observé"]) as never)).toEqual({
      key: "dossiers.check.noSignal",
      count: 0,
      tone: "success",
    });
    expect(checkFact({ studio: "document-authenticity", status: "running", report: null } as never)).toEqual({
      key: "dossiers.check.running",
      count: 0,
      tone: "neutral",
    });
    expect(checkFact({ studio: "compliance-check", status: "failed", report: null } as never)).toEqual({
      key: "dossiers.check.failed",
      count: 0,
      tone: "neutral",
    });
  });

  it("builds the applicant's link from the token the request returns once", () => {
    expect(applicantLink("https://www.verikora.com", "fr", "tok_123")).toBe(
      "https://www.verikora.com/fr/dossier/tok_123",
    );
  });

  it("reads no server module, so the browser can draw « Dossiers » (a client import of the database broke the page)", () => {
    for (const file of ["applicant-file-face.ts", "applicant-file-rules.ts", "document-face.ts"]) {
      const imports = [
        ...readFileSync(join(__dirname, file), "utf8").matchAll(/^import (?!type )[^;]*from "([^"]+)"/gm),
      ].map((m) => m[1]);
      expect(imports.filter((i) => /\/(db|applicant-consent|applicant-file|documents|audit)$/.test(i!))).toEqual([]);
    }
  });
});
