import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Yomizaka verifies documents and screens files: it never verifies an identity (#371). */
const FORBIDDEN: Record<string, RegExp> = {
  en: /identity verif|verif\w* (?:your |an? |the )?identity|identity check|identity proof|\bKYC\b/i,
  fr: /v[ée]rification d.identit[ée]|v[ée]rifi\w* (?:votre |l.|une )?identit[ée]|contr[ôo]le d.identit[ée]|\bKYC\b/i,
};
const LEGAL_RULES: Record<string, RegExp> = { en: /legal rules/i, fr: /r[èe]gles juridiques/i };

function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

function catalogue(lang: string): [string, string][] {
  return leaves(JSON.parse(readFileSync(join(__dirname, "..", "messages", `${lang}.json`), "utf8")));
}

describe.each(["en", "fr"])("public wording (%s)", (lang) => {
  const texts = catalogue(lang);

  it("never says Yomizaka verifies an identity, nor calls its tools « legal rules »", () => {
    const offenders = texts.filter(([, v]) => FORBIDDEN[lang].test(v) || LEGAL_RULES[lang].test(v)).map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it("describes the landing and the report as document verification and file screening", () => {
    const get = (key: string) => texts.find(([k]) => k === key)?.[1] ?? "";
    const matrices =
      lang === "fr"
        ? /matrices d.extraction documentaire et des gabarits technologiques param[ée]trables/
        : /extraction matrices and technical templates/;
    expect(get("landing.lead")).not.toMatch(matrices); // the lead is in plain words (2026-11-05); the legal wording stays in the disclaimer
    expect(get("report.disclaimer")).toMatch(matrices);
    expect(get("report.disclaimer")).toMatch(
      lang === "fr" ? /valid[ée]s par le conseiller juridique du client/ : /validated by the client's counsel/,
    );
    expect(get("report.disclaimer")).toMatch(lang === "fr" ? /ce n.est pas un avis juridique/ : /not legal advice/);
  });
});
