"use client";

import { Badge } from "@krizaka/ui/badge";

import { useSay } from "@/lib/i18n-client";
import type { RegistryReport } from "@/lib/registries/report";
import type { RegistrySignal } from "@/lib/registries/signals";
import { levelTone } from "@/lib/signal-cards";

import { formatDate } from "./format";

/**
 * The business registers' part of the report (verikora#627): the QST number printed on the document, read against Revenu Québec's
 * public register. REG-001/002/003 are questions for the issuer, never a verdict; a register that was not consulted (the GST/HST
 * registry, the NEQ) says « not looked up », with its reason, so the silence is never read as a clean answer.
 */
export function RegistryChecks({ report }: Readonly<{ report: RegistryReport }>) {
  const { say, locale } = useSay();
  const t = (key: string, vars?: Record<string, string | number>) => say(`analysis.registry.${key}`, vars);
  const word = (s: RegistrySignal, field: "observation" | "mayIndicate" | "askFor" | "where") =>
    s[field] ? t(`signals.${s.signalId}.${field}`, s.vars) : null;
  const notLooked = (reason: string | null) => t(`notLookedUp.${reason ?? "unavailable"}`);
  return (
    <section className="flex flex-col gap-3" aria-label={t("title")} data-testid="registry-checks">
      <h2 className="font-display text-lg font-bold text-fg">{t("title")}</h2>
      <p className="m-0 text-sm text-fg-secondary">{t("lead")}</p>
      <dl className="m-0 flex flex-col gap-2 text-sm">
        <div data-testid="registry-qst">
          <dt className="font-semibold text-fg">{t("qst", { number: report.number })}</dt>
          <dd className="m-0 text-fg-secondary">
            {report.qst.looked
              ? t("source", { source: report.source, date: formatDate(report.consultedAt, locale, true) })
              : notLooked(report.qst.reason)}
          </dd>
        </div>
        <div data-testid="registry-gst">
          <dt className="font-semibold text-fg">{t("gstHst")}</dt>
          <dd className="m-0 text-fg-secondary">{notLooked(report.gstHst)}</dd>
        </div>
        <div data-testid="registry-neq">
          <dt className="font-semibold text-fg">{t("neq")}</dt>
          <dd className="m-0 text-fg-secondary">{notLooked(report.neq)}</dd>
        </div>
      </dl>
      {report.qst.looked && report.qst.signals.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{t("nothingToAsk")}</p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {report.qst.signals.map((s) => (
          <li
            key={s.signalId}
            className="rounded-lg border border-border-default bg-surface-1 p-3 text-sm"
            data-level={s.level}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">{s.signalId}</span>
              <Badge tone={levelTone(s.level)}>{say(`analysis.levels.${s.level}`)}</Badge>
            </div>
            <p className="mt-1 text-fg">
              <strong className="font-semibold">{say("analysis.traces.observed")} · </strong>
              {word(s, "observation")}
            </p>
            {s.where ? <p className="mt-1 text-xs text-fg-muted">{word(s, "where")}</p> : null}
            {s.mayIndicate ? (
              <p className="mt-1 text-fg-secondary">
                <strong className="font-semibold">{say("analysis.mayIndicate")} · </strong>
                {word(s, "mayIndicate")}
              </p>
            ) : null}
            {s.askFor ? (
              <p className="mt-1 text-fg">
                <strong className="font-semibold">{say("analysis.traces.askForLabel")} · </strong>
                {word(s, "askFor")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
