"use client";

import { Badge } from "@krizaka/ui/badge";
import { List } from "@krizaka/ui/list";
import Link from "next/link";

import { CONSOLE_ROUTES } from "@/lib/console-nav";
import type { CheckSummary } from "@/lib/checks";
import type { CreditsFigure } from "@/lib/home-b2";
import { latestChecksOf, reportHref, type ToTreatRow } from "@/lib/home-todo";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { STATUS_TONE } from "./DocumentTable";
import { formatDate } from "./format";

/** The plan and usage as one discreet line under the home's lists (« 12 sur 100 vérifications ce mois-ci »), a link to Plan and billing; no card, no figures wall. */
type Say = ReturnType<typeof useSay>["say"];
function usageText(figure: CreditsFigure, say: Say, locale: "en" | "fr"): string {
  if (figure.kind === "included") {
    return say("home.credits.included");
  }
  if (figure.kind === "credits") {
    return say(pluralKey("home.credits.left", figure.left), { count: figure.left });
  }
  const renewsKey = figure.cancelled ? "home.credits.ends" : "home.credits.renews";
  const renews = figure.renewsAt ? say(renewsKey, { date: formatDate(figure.renewsAt, locale) }) : null;
  return [say("home.credits.pro", { used: figure.used, cap: figure.cap }), renews].filter(Boolean).join(" · ");
}

export function UsageLine({ figure }: Readonly<{ figure: CreditsFigure }>) {
  const { say, locale } = useSay();
  const text = usageText(figure, say, locale);
  return (
    <p
      className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm text-fg-secondary"
      aria-label={say("home.usage.label")}
      data-testid="credits"
    >
      <span>{text}</span>
      <Link
        href={`/${locale}${CONSOLE_ROUTES.plans}`}
        className="inline-flex min-h-11 items-center font-semibold text-fg-accent hover:underline"
      >
        {say("home.credits.manage")} →
      </Link>
    </p>
  );
}

const SECTION_TITLE = "m-0 font-display text-lg font-bold text-fg";

/** « À traiter » (krizaka-internal#2290): the files and checks waiting for the manager, five rows at most, each a link to what needs a decision; an honest empty state. */
export function ToTreat({ rows, className }: Readonly<{ rows: readonly ToTreatRow[]; className?: string }>) {
  const { say, locale } = useSay();
  return (
    <section className={className} aria-labelledby="home-todo-title" data-testid="home-todo">
      <h2 id="home-todo-title" className="m-0 mb-3 font-display text-lg font-bold text-fg">
        {say("home.treat.title")}
      </h2>
      <List
        items={rows}
        getId={(r) => `${r.kind}-${r.id}`}
        aria-label={say("home.treat.label")}
        chevrons
        empty={<p className="m-0 text-sm text-fg-secondary">{say("home.treat.empty")}</p>}
        row={(r) => ({
          title: r.name,
          href: r.href,
          description:
            r.kind === "file"
              ? say("home.treat.file", { date: formatDate(r.at, locale) })
              : [say(`batch.studios.${r.studio}`), formatDate(r.at, locale)].join(" · "),
          meta:
            r.kind === "check" ? (
              <Badge tone={STATUS_TONE[r.result]} dot size="sm">
                {say(`statuses.${r.result}`)}
              </Badge>
            ) : (
              <Badge tone="warning" dot size="sm">
                {say("home.treat.toDecide")}
              </Badge>
            ),
        })}
      />
    </section>
  );
}

/** « Dernières vérifications »: the last five checks, newest first — the document, the check, its state in words, a link to the report. */
export function LatestChecks({ checks }: Readonly<{ checks: readonly CheckSummary[] }>) {
  const { say, locale } = useSay();
  const rows = latestChecksOf(checks);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="home-latest-title" data-testid="home-latest-checks">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-latest-title" className={SECTION_TITLE}>
          {say("home.latest.title")}
        </h2>
        {rows.length ? (
          <Link
            href={`/${locale}${CONSOLE_ROUTES.checks}`}
            className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-fg-accent hover:underline"
          >
            {say("home.latest.all")} →
          </Link>
        ) : null}
      </div>
      <List
        items={rows}
        getId={(c) => c.id}
        aria-label={say("home.latest.label")}
        chevrons
        empty={<p className="m-0 text-sm text-fg-secondary">{say("home.latest.empty")}</p>}
        row={(c) => ({
          title: c.title,
          href: reportHref(locale, c),
          description: [say(`batch.studios.${c.studio}`), formatDate(c.at, locale)].join(" · "),
          meta: (
            <Badge tone={STATUS_TONE[c.result]} dot size="sm">
              {say(`statuses.${c.result}`)}
            </Badge>
          ),
        })}
      />
    </section>
  );
}
