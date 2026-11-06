import { SIGNAL_LEVELS } from "@verikora/core";

import { formatDate } from "@/components/console/format";

import { type Locale, translator } from "./i18n";
import type { OwnerSignal } from "./owner-report";
import { askForOf, evidenceLines, groupByFamily, ordinaryOf, type TraceSay } from "./signal-cards";

/**
 * The owner's traces of editing (verikora#625), as plain lines for the page and for the signed PDF, from the same cards as the
 * person's own report: the level and what was observed, where (page, later save, field), the ordinary explanations, what to ask for.
 * The same words in both; never a total, a score or a verdict.
 */
export interface OwnerTraceGroup {
  family: string;
  title: string;
  cards: string[][];
}

export function traceCardsOf(signals: readonly OwnerSignal[], lang: Locale): OwnerTraceGroup[] {
  const t = translator(lang) as unknown as (key: string, vars?: Record<string, string | number>) => string;
  const say: TraceSay = (key, vars) => t(`console.analysis.traces.${key}`, vars);
  const asSignal = (s: OwnerSignal) => ({
    signalId: s.id,
    level: s.level,
    observation: s.observation,
    family: s.family,
    evidence: s.evidence,
    answer: s.answer,
  });
  return groupByFamily(signals.map(asSignal)).map((g) => ({
    family: g.family,
    title: say(`families.${g.family}`),
    cards: g.signals.map((s) => {
      const where = evidenceLines(say, s).join(" · ");
      const level = (SIGNAL_LEVELS as readonly string[]).includes(s.level)
        ? t(`console.analysis.levels.${s.level}`)
        : s.level;
      const head = `${level}: ${s.observation}`;
      const lines = [
        where ? `${head} (${where})` : head,
        `${say("ordinaryLabel")}: ${ordinaryOf(say, s)}`,
        `${say("askForLabel")}: ${askForOf(say, s)}`,
      ];
      return s.answer
        ? [...lines, `${say("answerLabel", { date: formatDate(s.answer.at, lang) })}: ${s.answer.text}`]
        : lines;
    }),
  }));
}
