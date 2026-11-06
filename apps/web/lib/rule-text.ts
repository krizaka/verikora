import { allCompliancePacks, type CompliancePack, say } from "./closing-note/data";
import type { Lang } from "./closing-note/vocabulary";

/*
 * The words of a rule in the reader's language (verikora#246). They are written once per language with the ruleset, as data
 * (`closing-note/data/<pack>.json`): never translated at runtime. The ruleset's own French wording is kept exact; the legal
 * references, the quoted passages, the names, amounts and dates are never touched here. A rule the data does not know keeps the
 * engine's own text (French), and `missingRuleTexts` is the build-time guard that no rule is left without its pair.
 */

const packOf = (ruleId: string): CompliancePack | undefined => allCompliancePacks().find((p) => ruleId in p.ruleTitles);

/** The rule's name in `lang`, or `fallback` (the engine's wording) when the ruleset data does not carry it. */
export function ruleTitle(ruleId: string, lang: Lang, fallback: string | null | undefined): string {
  if (lang === "fr" && fallback) return fallback;
  const t = packOf(ruleId)?.ruleTitles[ruleId];
  return t ? say(t, lang) : (fallback ?? ruleId);
}

/**
 * The finding's explanation in `lang`. French is the engine's own text, always kept exact. English is the pack's sentence only when the
 * engine's French equals the pack's French word for word (so nothing specific, a name or an amount, is lost); otherwise the engine's text stays.
 */
export function ruleExplanation(ruleId: string, lang: Lang, fallback: string, english?: string): string {
  if (lang === "fr") return fallback;
  if (english) return english;
  const plain = allCompliancePacks().find((p) => ruleId in p.rules)?.rules[ruleId];
  const match = plain && [plain.ok, plain.attention].find((t) => t.fr === fallback);
  return match ? say(match, lang) : fallback;
}

/** The guard: the rule ids (read from recorded runs, a fixture, a ruleset) that lack a name or a plain sentence in either language. */
export function missingRuleTexts(
  ruleIds: Iterable<string>,
  packs: readonly CompliancePack[] = allCompliancePacks(),
): string[] {
  const missing: string[] = [];
  for (const id of ruleIds) {
    const title = packs.map((p) => p.ruleTitles[id]).find(Boolean);
    if (!title?.fr?.trim() || !title.en?.trim()) missing.push(id);
  }
  return missing;
}
