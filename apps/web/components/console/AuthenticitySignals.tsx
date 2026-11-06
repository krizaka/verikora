"use client";

import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import type { AuthenticityReport, TextSource } from "@verikora/core";

import { useSay } from "@/lib/i18n-client";
import { photoOriginSignals } from "@/lib/photo-origin";
import type { Answer } from "@/lib/signal-answers";
import { askForOf, groupByFamily, levelTone, ordinaryOf, type TraceSay, whereOf } from "@/lib/signal-cards";

import { formatDate } from "./format";

/** The box at the top: what this check is not, and what it did not examine (ADR-0014 §6). */
function NotACheck({ say, notExamined }: Readonly<{ say: TraceSay; notExamined: string[] }>) {
  const items = ["alteration", "ordinary", "absence", "person"].map((n) => say(`notItems.${n}`));
  return (
    <Alert tone="info" data-testid="traces-not">
      <p className="m-0 font-semibold">{say("notTitle")}</p>
      <ul className="m-0 mt-1 list-disc pl-5">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {notExamined.length ? <p className="m-0 mt-1">{say("notExamined", { list: notExamined.join(", ") })}</p> : null}
    </Alert>
  );
}

const asList = (v: string | string[] | undefined): string[] => [v ?? []].flat();

/**
 * The authenticity Studio's signals as traces of editing (verikora#625): grouped by family, each card says what we observed, where
 * (page, later save, field), what it may indicate with its ordinary explanations, what to ask for, and the run. Levels are words;
 * « inconsistent » is a warning, never red; no total, no score, no sort of anything.
 */
export function AuthenticitySignals({
  report,
  runId,
  answers,
}: Readonly<{
  report: Pick<AuthenticityReport, "header" | "signals"> & { notExamined?: string | string[] };
  runId?: string | null;
  answers?: Record<string, Answer>;
}>) {
  const { say: sayAll, locale } = useSay();
  const say: TraceSay = (key, vars) => sayAll(`analysis.traces.${key}`, vars);
  return (
    <section className="flex flex-col gap-3" aria-label={say("title")} data-testid="traces">
      <h2 className="font-display text-lg font-bold text-fg">{say("title")}</h2>
      <NotACheck say={say} notExamined={asList(report.notExamined)} />
      {report.header ? <Alert tone="info">{report.header}</Alert> : null}
      {groupByFamily(report.signals).map((g) => (
        <div key={g.family} className="flex flex-col gap-2" data-family={g.family}>
          <h3 className="m-0 text-sm font-semibold text-fg">{say(`families.${g.family}`)}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.signals.map((s) => (
              <li
                key={`${s.signalId}-${s.observation}`}
                className="rounded-lg border border-border-default bg-surface-1 p-3 text-sm"
                data-level={s.level}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">{s.signalId}</span>
                  <Badge tone={levelTone(s.level)}>{sayAll(`analysis.levels.${s.level}`)}</Badge>
                </div>
                <p className="mt-1 text-fg">
                  <strong className="font-semibold">{say("observed")} · </strong>
                  {s.observation}
                </p>
                {whereOf(say, s) ? <p className="mt-1 text-xs text-fg-muted">{whereOf(say, s)}</p> : null}
                {s.mayIndicate ? (
                  <p className="mt-1 text-fg-secondary">
                    <strong className="font-semibold">{sayAll("analysis.mayIndicate")} · </strong>
                    {s.mayIndicate}
                  </p>
                ) : null}
                <p className="mt-1 text-fg-secondary">
                  <strong className="font-semibold">{say("ordinaryLabel")} · </strong>
                  {ordinaryOf(say, s)}
                </p>
                <p className="mt-1 text-fg">
                  <strong className="font-semibold">{say("askForLabel")} · </strong>
                  {askForOf(say, s)}
                </p>
                {answers?.[s.signalId] ? (
                  <p className="mt-1 rounded-md bg-surface-2 p-2 text-fg" data-testid="trace-answer">
                    <strong className="font-semibold">
                      {say("answerLabel", { date: formatDate(answers[s.signalId]!.at, locale, true) })} ·{" "}
                    </strong>
                    {answers[s.signalId]!.text}
                  </p>
                ) : null}
                {runId ? <p className="mt-1 text-xs text-fg-muted">{say("run", { runId })}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** A photo document's origin, read at upload (its metadata never leaves the intake, ADR-0010), as the report's signals. */
export function PhotoOriginSignals({ source }: Readonly<{ source: TextSource }>) {
  const { say, locale } = useSay();
  const signals = photoOriginSignals(source.origin).map((s) => {
    const facts = {
      ...s.facts,
      ...(s.facts.taken
        ? { taken: formatDate(s.facts.taken, locale, true), modified: formatDate(s.facts.modified, locale, true) }
        : {}),
    };
    return {
      signalId: s.signalId,
      level: s.level,
      observation: say(`analysis.photoOrigin.${s.case}.observation`, facts),
      mayIndicate: say(`analysis.photoOrigin.${s.case}.mayIndicate`),
      where: say("analysis.photoOrigin.where"),
    };
  });
  return <AuthenticitySignals report={{ header: say("analysis.photoOrigin.header"), signals }} />;
}
