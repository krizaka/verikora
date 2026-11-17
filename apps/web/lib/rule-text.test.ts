import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { allCompliancePacks } from "./closing-note/data";
import { LANGS } from "./closing-note/vocabulary";
import { pickReportLang } from "./owner-report-lang";
import { buildPayload, renderBody, sha256 } from "./report";
import { reportLabels } from "./report-labels";
import { missingRuleTexts, readableEngineText, ruleExplanation, ruleTitle } from "./rule-text";

const lease = allCompliancePacks().find((p) => p.pack === "qc-residential-lease")!;
const okFr = lease.rules["QC-LEASE-003"]!.ok.fr;
const attentionFr = lease.rules["QC-LEASE-004"]!.attention.fr;

const doc = { sha256: sha256("lease bytes"), filename: "bail.pdf", title: "Bail (fictif)", sizeBytes: 11, pages: 1 };
const analysis = {
  id: "a1",
  studio: "compliance-check" as const,
  status: "succeeded" as const,
  runId: "run-123",
  blueprintVersion: "1.2.0",
  inputs: {},
  report: {
    rulesetId: "qc-residential-lease",
    rulesetVersion: "2024-02-21",
    rulesetRevision: 2,
    jurisdiction: "QC",
    asOf: "2026-10-22",
    findings: [
      {
        ruleId: "QC-LEASE-004",
        title: lease.ruleTitles["QC-LEASE-004"]!.fr,
        severity: "BLOCKING",
        verdict: "FAIL",
        explanation: attentionFr,
        citation: "C.c.Q., art. 1904",
        evidenceSpan: { quote: "dépôt de sécurité de 1 450 $" },
      },
      {
        ruleId: "QC-LEASE-003",
        title: lease.ruleTitles["QC-LEASE-003"]!.fr,
        severity: "BLOCKING",
        verdict: "PASS",
        explanation: okFr,
      },
      {
        ruleId: "QC-LEASE-005",
        title: lease.ruleTitles["QC-LEASE-005"]!.fr,
        severity: "BLOCKING",
        verdict: "FAIL",
        explanation: "Texte propre à ce bail : 3 chèques.",
      },
    ],
  },
  error: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  finishedAt: "2026-10-22T10:00:05.000Z",
};

describe("the rules' words in both languages", () => {
  it("keeps the engine's French exactly and gives the English from the ruleset data", () => {
    expect(ruleTitle("QC-LEASE-004", "fr", "Titre du moteur")).toBe("Titre du moteur");
    expect(ruleTitle("QC-LEASE-004", "en", "Titre du moteur")).toBe(lease.ruleTitles["QC-LEASE-004"]!.en);
    expect(ruleExplanation("QC-LEASE-003", "fr", okFr)).toBe(okFr);
    expect(ruleExplanation("QC-LEASE-003", "en", okFr)).toBe(lease.rules["QC-LEASE-003"]!.ok.en);
  });

  it("shows a readable label instead of the engine's raw 'no usable verdict' sentence", () => {
    const raw = "Le modèle n'a pas rendu de verdict exploitable pour cette règle.";
    expect(ruleExplanation("QC-LEASE-011", "fr", raw)).toBe("Le document ne permet pas de conclure sur cette règle.");
    expect(ruleExplanation("QC-LEASE-011", "en", raw)).toBe("The document does not allow a conclusion on this rule.");
    expect(readableEngineText(raw)).toBe("Le document ne permet pas de conclure sur cette règle.");
    expect(ruleExplanation("QC-LEASE-011", "en", readableEngineText(raw))).toBe(
      "The document does not allow a conclusion on this rule.",
    );
  });

  it("never invents a translation: a text the data does not match word for word stays as the engine wrote it", () => {
    expect(ruleExplanation("QC-LEASE-005", "en", "Texte propre à ce bail : 3 chèques.")).toBe(
      "Texte propre à ce bail : 3 chèques.",
    );
    expect(ruleTitle("QC-UNKNOWN-001", "en", "Règle inconnue")).toBe("Règle inconnue");
  });

  it("every rule observed in the recorded runs has its name in both languages", () => {
    const dir = join(__dirname, "..", "content");
    const ids = new Set<string>();
    const walk = (d: string) =>
      readdirSync(d, { withFileTypes: true }).forEach((e) => {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith(".json"))
          for (const m of readFileSync(join(d, e.name), "utf8").matchAll(/ruleId\\*"\s*:\s*\\*"(QC-[A-Z]+-\d+)/g))
            ids.add(m[1]!);
      });
    walk(dir);
    expect(ids.size).toBeGreaterThan(10);
    expect(missingRuleTexts(ids)).toEqual([]);
  });

  it("the guard fails on a fixture with a rule lacking a translation", () => {
    const fixture = [
      {
        ...lease,
        ruleTitles: { "QC-LEASE-004": { fr: "Dépôt", en: "" }, "QC-LEASE-003": { fr: "Loyer", en: "Rent" } },
      },
    ];
    expect(missingRuleTexts(["QC-LEASE-004", "QC-LEASE-003", "QC-LEASE-999"], fixture)).toEqual([
      "QC-LEASE-004",
      "QC-LEASE-999",
    ]);
  });
});

describe.each(LANGS)("the report in %s", (lang) => {
  const payload = buildPayload(doc, analysis, lang);

  it("renders in the language, quote and article untouched", () => {
    const html = renderBody(payload, reportLabels(lang));
    expect(html).toContain(`lang="${lang}"`);
    expect(html).toContain("dépôt de sécurité de 1 450 $");
    expect(html).toContain("C.c.Q., art. 1904");
    expect(html).toContain(reportLabels(lang).languageNote!);
  });

  it("snapshot of the findings", () => {
    expect(
      payload.findings.map(({ ruleId, title, explanation, citation, quote }) => ({
        ruleId,
        title,
        explanation,
        citation,
        quote,
      })),
    ).toMatchSnapshot();
  });
});

describe("the owner page's language", () => {
  it("is the one asked, else the browser's best supported, else the page's", () => {
    expect(pickReportLang("en", "fr-CA,fr;q=0.9", "fr")).toBe("en");
    expect(pickReportLang(undefined, "de,en-GB;q=0.8,fr;q=0.5", "fr")).toBe("en");
    expect(pickReportLang(undefined, "fr-CA,en;q=0.5", "en")).toBe("fr");
    expect(pickReportLang("xx", "de", "fr")).toBe("fr");
    expect(pickReportLang(undefined, null, "en")).toBe("en");
  });
});
