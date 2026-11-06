import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildNote, type ClosingNote, closingNote, type FindingInput, type NoteInput } from "./build";
import { compliancePackOf, PACKS_WITH_NOTES } from "./data";
import { readabilityProblems } from "./readability";
import { LANGS, NOTE_KIND, NOTE_SOURCE, SEVERITY, VERDICT } from "./vocabulary";

const ROOT = join(__dirname, "../..");

/** The compliance reports Sovkora really returned, recorded with the app: one fixture per pack and per outcome. */
function reportsIn(dir: string) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(".json"))
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(ROOT, dir, file), "utf8"));
      const found: Record<string, unknown>[] = [];
      const walk = (o: unknown) => {
        if (typeof o === "string" && o.trim().startsWith("{")) {
          return walk(JSON.parse(o));
        }
        if (Array.isArray(o)) {
          return o.forEach(walk);
        }
        if (o && typeof o === "object") {
          if ("findings" in o && "rulesetId" in o) {
            found.push(o as Record<string, unknown>);
          }
          Object.values(o).forEach(walk);
        }
      };
      walk(raw);
      return {
        file,
        report: found[0] as { rulesetId: string; asOf: string; reviewStatus?: string; findings: FindingInput[] },
      };
    });
}
const FIXTURES = [...reportsIn("content/pack-proofs"), ...reportsIn("content/recorded-runs").filter((r) => r.report)];
const compliance = (r: (typeof FIXTURES)[number]): NoteInput => ({
  kind: NOTE_KIND.compliance,
  rulesetId: r.report.rulesetId,
  asOf: r.report.asOf,
  reviewStatus: r.report.reviewStatus,
  findings: r.report.findings,
});

const AUTHENTICITY: NoteInput = {
  kind: NOTE_KIND.authenticity,
  notExamined: ["Le contenu des images."],
  signals: [
    {
      signalId: "PDF-META-001",
      level: "observé",
      observation: "Le fichier a été produit par un logiciel de traitement de texte.",
    },
    { signalId: "PDF-META-002", level: "incohérent", observation: "Le producteur déclaré ne correspond pas." },
    { signalId: "PDF-META-003", level: "inhabituel", observation: "Le fichier a été modifié trois fois." },
  ],
};
const NO_SIGNALS: NoteInput = { kind: NOTE_KIND.authenticity, signals: [] };

const textsOf = (n: ClosingNote) => [
  n.what.text,
  ...n.how.sentences,
  ...n.notChecked.items,
  n.result.text,
  ...n.next.items.flatMap((i) => [i.problem, i.advice]),
  ...(n.next.none ? [n.next.none] : []),
  n.decides.text,
  n.disclaimer,
  ...(n.reviewPending ? [n.reviewPending] : []),
];

const CASES = [
  ...FIXTURES.map((f) => [f.file, compliance(f)] as const),
  ["authenticity with signals", AUTHENTICITY] as const,
  ["authenticity with nothing found", NO_SIGNALS] as const,
];

describe("the closing note", () => {
  it("every rules pack with a recorded report is covered", () => {
    expect(new Set(FIXTURES.map((f) => f.report.rulesetId))).toEqual(new Set(PACKS_WITH_NOTES));
  });

  describe.each(CASES)("%s", (_name, input) => {
    it.each(LANGS)("%s: has every section, the disclaimer and who decides", (lang) => {
      const note = buildNote(input, lang);
      expect(closingNote.parse(note)).toEqual(note);
      for (const text of [
        note.what.text,
        note.result.text,
        note.decides.text,
        note.disclaimer,
        note.how.sentences[0]!,
      ]) {
        expect(text.length).toBeGreaterThan(10);
      }
      expect(note.how.sentences.length).toBeGreaterThanOrEqual(2);
      expect(note.notChecked.items.length).toBeGreaterThanOrEqual(1);
      expect(note.disclaimer).toMatch(lang === "fr" ? /pas un avis juridique/ : /not legal advice/);
    });

    it.each(LANGS)("%s: reads in plain words (short sentences, no jargon, no unexplained acronym)", (lang) => {
      expect(readabilityProblems(textsOf(buildNote(input, lang)))).toEqual([]);
    });
  });

  describe.each(FIXTURES)("compliance result of $file", (fixture) => {
    const { findings } = fixture.report;
    it.each(LANGS)("%s: counts what the report found and says nothing else", (lang) => {
      const note = buildNote(compliance(fixture), lang);
      const failed = findings.filter((f) => f.verdict === VERDICT.fail).length;
      const undecided = findings.filter((f) => f.verdict === VERDICT.undecided).length;
      expect(note.next.items).toHaveLength(failed + undecided);
      expect(note.what.text).toContain(String(findings.length));
      if (failed === 0 && undecided === 0) {
        expect(note.next.none).not.toBeNull();
      } else {
        expect(note.result.text).toMatch(/\d/);
      }
    });

    it.each(LANGS)(
      "%s: the most important findings come first, and every one has a plain text from the pack",
      (lang) => {
        const note = buildNote(compliance(fixture), lang);
        const important = note.next.items.map((i) => i.important);
        expect(important).toEqual([...important].sort((a, b) => Number(b) - Number(a)));
        expect(note.next.items.every((i) => i.source === NOTE_SOURCE.pack)).toBe(true);
      },
    );
  });

  it.each(LANGS)("%s: says what was not checked — the service contract names the articles it left out", (lang) => {
    const f = FIXTURES.find((x) => x.report.rulesetId === "qc-service-contract")!;
    expect(buildNote(compliance(f), lang).notChecked.items.join(" ")).toContain("2125");
  });

  it.each(LANGS)("%s: a defective lease tells the tenant to ask for the deposit clause to be removed", (lang) => {
    const f = FIXTURES.find((x) => x.file === "qc-residential-lease--fr-defective.json")!;
    const note = buildNote(compliance(f), lang);
    expect(
      note.next.items.some((i) =>
        i.advice.includes(lang === "fr" ? "retirer la clause de dépôt" : "remove the deposit clause"),
      ),
    ).toBe(true);
    expect(note.next.items[0]!.important).toBe(true);
  });

  it.each(LANGS)(
    "%s: a rule the pack has no plain text for falls back to the report's own words and says so",
    (lang) => {
      const note = buildNote(
        {
          kind: NOTE_KIND.compliance,
          rulesetId: "qc-new-pack",
          asOf: "2026-10-22",
          findings: [
            {
              ruleId: "X-1",
              title: "Une règle",
              severity: SEVERITY.major,
              verdict: VERDICT.fail,
              explanation: "Le document ne dit pas X.",
            },
          ],
        },
        lang,
      );
      expect(note.next.items[0]).toMatchObject({ problem: "Le document ne dit pas X.", source: NOTE_SOURCE.report });
      expect(note.what.text).toContain("qc-new-pack");
    },
  );

  it.each(LANGS)("%s: a pack still waiting for a lawyer's review says it", (lang) => {
    const f = FIXTURES.find((x) => x.report.reviewStatus)!;
    expect(buildNote(compliance(f), lang).reviewPending).not.toBeNull();
  });

  it.each(LANGS)("%s: the date of the rules is written in full", (lang) => {
    const note = buildNote(
      {
        kind: NOTE_KIND.compliance,
        rulesetId: "qc-residential-lease",
        asOf: "2026-10-22",
        findings: [{ ruleId: "QC-LEASE-001", severity: SEVERITY.blocking, verdict: VERDICT.pass }],
      },
      lang,
    );
    expect(note.what.text).toContain(lang === "fr" ? "22 octobre 2026" : "October 22, 2026");
    expect(note.what.text).toContain(lang === "fr" ? "1 règle" : "1 rule");
  });

  it.each(LANGS)("%s: authenticity names what it looked at and sorts what does not fit first", (lang) => {
    const note = buildNote(AUTHENTICITY, lang);
    expect(note.what.text).toMatch(lang === "fr" ? /créé et modifié/ : /created and changed/);
    expect(note.next.items.map((i) => i.important)).toEqual([true, false]);
    expect(note.notChecked.items).toContain("Le contenu des images.");
  });
});

describe("the plain-language data", () => {
  it.each(PACKS_WITH_NOTES)("%s has a plain text, in both languages, for every rule it lists", (pack) => {
    const data = compliancePackOf(pack)!;
    for (const [ruleId, text] of Object.entries(data.rules)) {
      for (const lang of LANGS) {
        for (const kind of ["ok", "attention", "advice"] as const) {
          expect(text[kind][lang].length, `${ruleId} ${kind} ${lang}`).toBeGreaterThan(8);
        }
        expect(
          readabilityProblems([text.ok[lang], text.attention[lang], text.advice[lang]]),
          `${ruleId} ${lang}`,
        ).toEqual([]);
      }
    }
  });

  it("a rule that does not apply is not « could not be checked » (a clean lease says all is fine)", () => {
    const findings = [
      { ruleId: "A", title: "Loyer", severity: SEVERITY.blocking, verdict: VERDICT.pass },
      { ruleId: "B", title: "Dépôt", severity: SEVERITY.blocking, verdict: "NOT_APPLICABLE" },
    ] as FindingInput[];
    const note = buildNote(
      { kind: NOTE_KIND.compliance, rulesetId: "qc-residential-lease", asOf: "2026-10-29", findings },
      "en",
    );
    expect(JSON.stringify(note)).not.toMatch(/could not be checked|Dépôt/);
  });
});
