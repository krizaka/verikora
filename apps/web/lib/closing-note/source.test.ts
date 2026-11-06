import { describe, expect, it } from "vitest";

import { buildNote, type NoteInput } from "./build";
import { readabilityProblems } from "./readability";
import { LANGS, NOTE_KIND, SEVERITY, VERDICT } from "./vocabulary";

const lease = (
  textSource?: NoteInput extends infer T ? (T extends { textSource?: infer S } ? S : never) : never,
): NoteInput => ({
  kind: NOTE_KIND.compliance,
  rulesetId: "qc-residential-lease",
  asOf: "2026-10-22",
  findings: [{ ruleId: "QC-LEASE-001", severity: SEVERITY.blocking, verdict: VERDICT.pass }],
  textSource,
});
const ocr = { kind: "ocr", confidence: 88, lowConfidence: false } as const;

/** A photo is read by a machine, and the note says so where it matters: how the text was read, and what that cannot guarantee. */
describe("the closing note says how the text was read", () => {
  it.each(LANGS)(
    "%s: a document read from a photo says it, with the reading's reliability, and warns that a misread digit changes the result",
    (lang) => {
      const note = buildNote(lease(ocr), lang);
      expect(note.how.sentences.join(" ")).toContain("88");
      expect(note.how.sentences.join(" ")).toMatch(lang === "fr" ? /photo/ : /photo/);
      expect(note.notChecked.items.join(" ")).toMatch(lang === "fr" ? /chiffre mal lu/ : /misread/);
    },
  );

  it.each(LANGS)("%s: a low reliability says to re-read the amounts and dates", (lang) => {
    const note = buildNote(lease({ ...ocr, confidence: 52, lowConfidence: true }), lang);
    expect(note.how.sentences.join(" ")).toMatch(lang === "fr" ? /seulement de 52/ : /only 52/);
  });

  it.each(LANGS)("%s: a model's reading is named as a model's, without the jargon of the run", (lang) => {
    const note = buildNote(lease({ kind: "vision" }), lang);
    expect(note.how.sentences.join(" ")).toMatch(lang === "fr" ? /modèle/ : /model/);
    expect(note.how.sentences.join(" ")).not.toMatch(/Sovkora|run/);
  });

  it.each(LANGS)("%s: a PDF or a text file has no such sentence, and the note reads the same as before", (lang) => {
    const [plain, same] = [buildNote(lease(), lang), buildNote(lease(undefined), lang)];
    expect(plain).toEqual(same);
    expect(plain.how.sentences.join(" ")).not.toMatch(/photo/);
  });

  it.each(LANGS)("%s: reads in plain words", (lang) => {
    for (const s of [ocr, { ...ocr, lowConfidence: true, confidence: 40 }, { kind: "vision" }] as const) {
      const n = buildNote(lease(s), lang);
      expect(readabilityProblems([...n.how.sentences, ...n.notChecked.items])).toEqual([]);
    }
  });
});
