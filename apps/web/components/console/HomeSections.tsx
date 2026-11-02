"use client";

import Link from "next/link";

import { CONSOLE_ROUTES } from "@/lib/console-nav";
import type { CreditsFigure } from "@/lib/home-b2";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

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
