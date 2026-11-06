/**
 * A plain-language check for the closing note: short sentences, everyday words. The limits and the banned words are data,
 * so a stricter reader is a new line here, not a new code path.
 */
// @fixed: a sentence a person can read in one breath
export const MAX_WORDS_PER_SENTENCE = 28;
// @fixed: the average the whole note must keep under
export const MAX_AVERAGE_WORDS = 17;

/** Words and signs that mean « jargon » in a note for people who are not in IT or in law: the reader would stumble on them. */
export const JARGON = [
  "C.c.Q.",
  "RLRQ",
  "L.R.C.",
  "BLOCKING",
  "MAJOR",
  "ADVISORY",
  "INSUFFICIENT_EVIDENCE",
  "PASS",
  "FAIL",
  "verdict",
  "ruleset",
  "JSON",
  "SHA-256",
  "hash",
  "payload",
  "evidenceSpan",
  "run id",
  "Sovkora",
] as const;
/** Acronyms that may only appear when the sentence explains them. */
export const ACRONYMS_TO_EXPLAIN = ["TAL", "TPS", "TVQ", "GST", "QST"] as const;

export const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?:])\s+(?=[A-ZÀ-ÖØ-Þ«"0-9])/u)
    .map((s) => s.trim())
    .filter(Boolean);
export const wordsOf = (sentence: string): string[] => sentence.split(/\s+/).filter(Boolean);

export interface ReadabilityProblem {
  rule: "long-sentence" | "average" | "jargon" | "unexplained-acronym";
  detail: string;
}

/** What gets in the way of reading these sentences (empty when they read easily). */
export function readabilityProblems(texts: readonly string[]): ReadabilityProblem[] {
  const problems: ReadabilityProblem[] = [];
  const all = texts.flatMap(sentencesOf);
  for (const s of all) {
    if (wordsOf(s).length > MAX_WORDS_PER_SENTENCE) problems.push({ rule: "long-sentence", detail: s });
    for (const word of JARGON) if (s.includes(word)) problems.push({ rule: "jargon", detail: `${word} in: ${s}` });
    for (const acronym of ACRONYMS_TO_EXPLAIN)
      if (
        new RegExp(String.raw`\b${acronym}\b`).test(s) &&
        !/[(«—]|, la |, le |, the |\(the /.test(s) &&
        !/(taxe|tax)/i.test(s)
      )
        problems.push({ rule: "unexplained-acronym", detail: `${acronym} in: ${s}` });
  }
  const average = all.reduce((n, s) => n + wordsOf(s).length, 0) / Math.max(all.length, 1);
  if (average > MAX_AVERAGE_WORDS) problems.push({ rule: "average", detail: average.toFixed(1) });
  return problems;
}
