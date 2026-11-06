import type { Signal } from "@verikora/core";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { ANSWER_MAX, cleanAnswer } from "./signal-answer-rules";
import { applicantSignalsOf } from "./signal-answers";
import { VERDICT_WORDS } from "./signal-cards";

// Synthetic signals: a fictitious stub, nothing from a real document.
const SIGNALS: Signal[] = [
  {
    signalId: "PDF-REV-002",
    level: "incohérent",
    observation: "Une sauvegarde postérieure a remplacé l'objet du montant net.",
    evidence: { page: 2, box: [72, 600, 240, 618], revision: 2, field: "net" },
  },
  { signalId: "PDF-META-001", level: "observé", observation: "Producteur : un éditeur en ligne." },
];

describe("the applicant's answer to a trace (ADR-0014, verikora#626)", () => {
  it("collapses spaces and trims; an empty answer removes it", () => {
    expect(cleanAnswer("  Téléchargé   du portail\n de paie \t")).toBe("Téléchargé du portail de paie");
    expect(cleanAnswer(" \n ")).toBe("");
    expect(ANSWER_MAX).toBe(600);
  });

  it("shows the applicant the traces of their file with the answer given, and never the box", () => {
    const answers = new Map([
      ["PDF-REV-002", { text: "Signé après le téléchargement.", at: "2026-10-30T15:00:00.000Z" }],
    ]);
    const [rev, meta] = applicantSignalsOf({ signals: SIGNALS }, answers);
    expect(rev).toMatchObject({
      id: "PDF-REV-002",
      level: "incohérent",
      family: "history",
      evidence: { page: 2, revision: 2, field: "net" },
      answer: { text: "Signé après le téléchargement." },
    });
    expect(JSON.stringify(rev)).not.toContain("box");
    expect(meta?.answer).toBeNull();
    expect(applicantSignalsOf(null, new Map())).toEqual([]);
  });

  for (const [locale, messages] of [
    ["en", en],
    ["fr", fr],
  ] as const) {
    it(`uses none of the refused words in the new texts (verdict words), in ${locale}`, () => {
      const texts = [
        ...Object.values(messages.applicantFile.answer),
        messages.applicant.notice.examined,
        messages.applicant.notice.examinedTitle,
        messages.console.analysis.traces.answerLabel,
        messages.applicantFile.error.ANSWER_CLOSED,
        messages.applicantFile.error.ANSWER_TOO_LONG,
        messages.applicantFile.error.SIGNAL_NOT_FOUND,
      ];
      for (const t of texts) {
        expect(VERDICT_WORDS.test(t), t).toBe(false);
      }
    });
  }
});
