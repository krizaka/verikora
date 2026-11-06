import type { Analysis } from "@verikora/core";
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import fr from "../messages/fr.json";
import type { ApplicantFileView } from "./applicant-file";
import { ownerReportOf, referenceOf, shareDays, shareState } from "./owner-report";
import { traceCardsOf } from "./owner-traces";

const NOW = new Date("2026-10-27T12:00:00Z");
const check = (over: Partial<Analysis>): Analysis => ({
  id: "a",
  studio: "document-authenticity",
  status: "succeeded",
  runId: "run-1",
  blueprintVersion: "1.3.0",
  inputs: {},
  report: null,
  error: null,
  createdAt: NOW.toISOString(),
  finishedAt: NOW.toISOString(),
  ...over,
});
const file = (checks: Analysis[]): ApplicantFileView => ({
  id: "0a1b2c3d-0000-4000-8000-000000000000",
  candidateName: "Camille Fictif",
  candidateEmail: "camille@exemple.test",
  status: "used",
  createdAt: "",
  expiresAt: "",
  requestedTypes: [],
  submittedAt: null,
  revokedAt: null,
  closedAt: null,
  consents: [],
  documents: [
    {
      id: "d1",
      typeId: "pay-stub",
      filename: "talon-camille-fictif.pdf",
      sizeBytes: 10,
      pages: 2,
      retention: "after-check",
      purged: true,
      skipped: [],
      checks,
      answers: {},
    },
  ],
});
const sha = "a".repeat(64);
const authenticity = check({
  report: {
    signals: [{ signalId: "s1", level: "inhabituel", observation: "Two saves with different producers" }],
    notExamined: "the employer",
  },
});
const compliance = check({
  studio: "compliance-check",
  runId: "run-2",
  report: {
    rulesetId: "qc",
    rulesetVersion: "1.2",
    jurisdiction: "CA-QC",
    asOf: "2026-01-01",
    reviewStatus: "TO_REVIEW_BY_LAWYER",
    findings: [
      {
        ruleId: "r1",
        severity: "high",
        verdict: "FAIL",
        explanation: "kept out",
        citation: "C.c.Q. art. 1904",
        evidenceSpan: { quote: "Camille Fictif pays 900 $" },
      },
    ],
  },
});

describe("the owner's report (verikora#128)", () => {
  const report = ownerReportOf(file([authenticity, compliance]), new Map([["d1", sha]]), NOW);
  const text = JSON.stringify(report);

  it("keeps hashes, signals, rules, runs and versions", () => {
    expect(report.documents[0]).toMatchObject({ sha256: sha, pages: 2, typeId: "pay-stub" });
    expect(report.documents[0]!.signals).toEqual([
      { id: "s1", level: "inhabituel", observation: "Two saves with different producers", family: "history" },
    ]);
    expect(report.documents[0]!.findings).toEqual([
      { ruleId: "r1", verdict: "FAIL", severity: "high", citation: "C.c.Q. art. 1904" },
    ]);
    expect(report.documents[0]!.runs.map((r) => r.runId)).toEqual(["run-1", "run-2"]);
    expect(report.rulesets[0]).toMatchObject({ rulesetVersion: "1.2", reviewStatus: "TO_REVIEW_BY_LAWYER" });
  });

  it("redacts the name, the e-mail, the file name and every quoted passage", () => {
    for (const leak of ["Camille", "Fictif", "exemple.test", "talon-camille", "900", "kept out"]) {
      expect(text).not.toContain(leak);
    }
    expect(report.reference).toBe(referenceOf("0a1b2c3d-0000-4000-8000-000000000000"));
    expect(report.reference).toBe("0A1B2C3D");
  });

  it("drops a document with no hash and a seeded or unfinished check", () => {
    expect(ownerReportOf(file([authenticity]), new Map(), NOW).documents).toEqual([]);
    const r = ownerReportOf(
      file([
        check({ inputs: { seeded: "true" }, report: authenticity.report }),
        check({ status: "running", runId: "x" }),
      ]),
      new Map([["d1", sha]]),
      NOW,
    );
    expect(r.documents[0]!.runs).toEqual([]);
  });

  it("never says certificate, conformity or approval, and states the notice, in both languages", () => {
    for (const w of [en.ownerReport, fr.ownerReport]) {
      const words = JSON.stringify(w).toLowerCase();
      for (const banned of [
        "conforme",
        "conformity",
        "compliant",
        "certificat",
        "certificate",
        "authentique",
        "genuine",
        "approuvé",
        "approved",
        "refusé",
        "rejected",
        "faux",
        "fake",
        "forged",
      ]) {
        expect(words).not.toContain(banned);
      }
    }
    expect(en.ownerReport.notice).toContain("not legal advice");
    expect(fr.ownerReport.notice).toContain("ce n'est pas un avis juridique");
  });
});

describe("the share link's state", () => {
  const live = { expiresAt: new Date("2026-11-03T12:00:00Z"), revokedAt: null };
  it("is live until its expiry, expired after, revoked at once", () => {
    expect(shareState(live, NOW)).toBe("live");
    expect(shareState(live, new Date("2026-11-03T12:00:00Z"))).toBe("expired");
    expect(shareState({ ...live, revokedAt: NOW }, NOW)).toBe("revoked");
  });
  it("keeps the days within 1..30, 7 by default", () => {
    expect([shareDays(undefined), shareDays(0), shareDays(31), shareDays(1.5), shareDays(30), shareDays(3)]).toEqual([
      7, 7, 7, 7, 30, 3,
    ]);
  });
});

describe("the owner's signal (verikora#625)", () => {
  it("keeps the family and the page, revision and field, never the box", async () => {
    const { ownerSignalOf } = await import("./owner-report");
    expect(
      ownerSignalOf({
        signalId: "PDF-REV-002",
        level: "incohérent",
        observation: "o",
        evidence: { page: 2, box: [1, 2, 3, 4], revision: 2, field: "net" },
      }),
    ).toEqual({
      id: "PDF-REV-002",
      level: "incohérent",
      observation: "o",
      family: "history",
      evidence: { page: 2, revision: 2, field: "net" },
    });
    expect(ownerSignalOf({ signalId: "FILE-001", level: "observé", observation: "o" })).toEqual({
      id: "FILE-001",
      level: "observé",
      observation: "o",
      family: "across",
    });
  });
});

describe("the applicant's answer in the owner's report (verikora#626)", () => {
  const answered = file([authenticity]);
  answered.documents[0]!.answers = {
    s1: { text: "Téléchargé du portail de paie, puis signé.", at: "2026-10-29T15:00:00.000Z" },
  };
  const report = ownerReportOf(answered, new Map([["d1", sha]]), NOW);

  it("is carried next to its signal, dated, and only for that signal", () => {
    expect(report.documents[0]!.signals[0]!.answer).toEqual({
      text: "Téléchargé du portail de paie, puis signé.",
      at: "2026-10-29T15:00:00.000Z",
    });
    expect(
      ownerReportOf(file([authenticity]), new Map([["d1", sha]]), NOW).documents[0]!.signals[0],
    ).not.toHaveProperty("answer");
  });

  for (const lang of ["en", "fr"] as const) {
    it(`is the fourth line of the card, with its date, in ${lang}`, () => {
      const [card] = traceCardsOf(report.documents[0]!.signals, lang).flatMap((g) => g.cards);
      expect(card).toHaveLength(4);
      expect(card![3]).toContain("Téléchargé du portail de paie, puis signé.");
      expect(card![3]).toMatch(/2026/);
    });
  }
});
