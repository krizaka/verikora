import { HERO } from "@/content/recorded-runs/samples.mjs";

import { recordedRun } from "./recorded-runs";

/** The finding the home's hero shows: named as data next to the recorded runs (`HERO`), read from the run — never typed here. */
export function heroFinding() {
  const run = recordedRun(HERO.run);
  const finding = run.report.findings.find((f) => f.ruleId === HERO.rule);
  if (!finding) {
    throw new Error(`the hero's finding ${HERO.rule} is not in the recorded ${HERO.run} run`);
  }
  return finding;
}

/** An entry is evidence (an https URL), `evidence: null` with a gap, or `na` — the reason it does not apply (a string, per the standard's schema). */
export type DevPreview = { criteria: Record<string, { evidence?: string | null; na?: string | boolean }> };

/**
 * The honest status chip, read from the dev-preview record (dev-preview.json at the repository's root): « Dev preview »
 * only once every criterion has its evidence (or is not applicable); « In development » while one still has a gap.
 */
export function productStatus(preview: DevPreview): "development" | "preview" {
  return Object.values(preview.criteria).every((c) => typeof c.evidence === "string" || Boolean(c.na))
    ? "preview"
    : "development";
}

/**
 * The figures of the proof, counted from the recorded check (never typed): the rules evaluated, the distinct articles of
 * the Civil Code its findings cite, and the findings themselves.
 */
export function HERO_FIGURES(report: {
  findings: readonly { citation?: string | null }[];
  summary?: { rulesEvaluated?: number } | null;
}): { rules: number; articles: number; found: number } {
  const articles = new Set<string>();
  for (const f of report.findings)
    for (const m of (f.citation ?? "").matchAll(/art\.\s*(\d+)(?:\s*(?:et|,)\s*(\d+))?/g))
      for (const n of [m[1], m[2]]) if (n) articles.add(n);
  return {
    rules: report.summary?.rulesEvaluated ?? report.findings.length,
    articles: articles.size,
    found: report.findings.length,
  };
}
