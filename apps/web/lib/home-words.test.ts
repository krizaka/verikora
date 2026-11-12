import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { HERO_RULE } from "./landing";
import { recordedRun } from "./recorded-runs";

/** The ticket's list of words the home never uses (krizaka-internal#2562, krizaka-restricted#220), in both languages. */
const NEVER =
  /\bIA\b|\bAI\b|\bscore\b|\bfaux\b|\bfake\b|fraude|\bfraud|100\s?%\s?(sécurisé|secure)|antécédents judiciaires|criminal record|conforme à la Loi 25|filtrage|tri des candidats|candidate? screening|screening of applicants|applicant ranking/i;
/** A code name in a heading: the engine's and the owl's. */
const CODE_NAME = /sovkora|\bowl\b|\bhibou\b/i;

const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe.each([
  ["en", en],
  ["fr", fr],
])("the %s home's hero, closing and description", (_name, m) => {
  // The hero and the closing are this slice's; the sections between them follow in the next one.
  const owned = [m.landing.title, m.landing.lead, m.landing.status, m.landing.hero, m.landing.closing, m.meta];

  it("never use a word of the ticket's list", () => {
    expect(strings(owned).filter((s) => NEVER.test(s))).toEqual([]);
  });

  it("puts no code name in a heading", () => {
    expect([m.landing.title, m.landing.closing.title, m.landing.what.title].filter((s) => CODE_NAME.test(s))).toEqual(
      [],
    );
  });

  it("type neither the article nor the quote of the hero's finding: they are read from the recorded run", () => {
    const finding = recordedRun("tenant").report.findings.find((f) => f.ruleId === HERO_RULE)!;
    const typed = [finding.citation, finding.evidenceSpan?.quote, finding.title].filter((s): s is string => !!s);
    expect(typed.length).toBeGreaterThan(0);
    const all = [...strings(en.landing), ...strings(fr.landing)].join("\n");
    expect(typed.filter((t) => all.includes(t))).toEqual([]);
    expect(strings(m.landing.hero).filter((s) => /\bart(icle|\.)\s*\d/i.test(s))).toEqual([]);
  });
});
