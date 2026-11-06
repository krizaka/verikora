import type { Entitlement } from "./billing";
import { CONSOLE_ROUTES } from "./console-nav";
import { type ActivityDay, HOME_PERIOD_KEY, type HomePeriod, nothingToDo, type ToDo, toDoLinks } from "./home-figures";
import { pluralKey } from "./plural";

/*
 * The B2 home's pure pieces (verikora#332, design § 5.6): the sentence under the heading, « Le classeur », the activity
 * strip, the week chart and the credits. Pure: the queries are lib/home.ts and lib/credits.ts, the words are messages, the
 * drawing is components/console. Every figure here is computed from rows read over the chosen period.
 */

type Say = (key: string, vars?: Record<string, string | number>) => string;
type Locale = "en" | "fr";
type LeadId = "toReview" | "toDecide" | "openLinks";
const LEAD_IDS: readonly LeadId[] = ["toReview", "toDecide", "openLinks"];

export interface LeadPart {
  text: string;
  /** Set for a figure: it leads to the view it counts. */
  href?: string;
}

/**
 * « Vous avez 6 vérifications à regarder, 2 dossiers à décider et 1 lien de dépôt ouvert. » — each figure a link to its
 * view, at zero left out; with nothing at all, the one line of « À traiter ». The list is the locale's own (`Intl.ListFormat`).
 */
export function leadParts(todo: ToDo, locale: Locale, say: Say): LeadPart[] {
  if (nothingToDo(todo)) return [{ text: say("home.todo.nothing") }];
  const links = toDoLinks(locale);
  const shown = LEAD_IDS.filter((id) => !!todo[id]);
  const figure = new Map(
    shown.map((id) => [
      id,
      { text: say(pluralKey(`home.lead.${id}`, todo[id] as number), { count: todo[id] as number }), href: links[id] },
    ]),
  );
  const items = new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
    .formatToParts(shown)
    .map((p): LeadPart => (p.type === "element" ? figure.get(p.value as LeadId)! : { text: p.value }));
  // The sentence's frame is a message with `{items}`: the words before and after it are literals around the figures.
  const [before = "", after = ""] = say("home.lead.intro", { items: "\u0000" }).split("\u0000");
  return [{ text: before }, ...items, { text: after }].filter((p) => p.text !== "");
}

export type BinderHue = "accent" | "success" | "warning" | "danger" | "neutral";
const HUE_OF_LAST_CHECK: Record<"checked" | "attention" | "failed", BinderHue> = {
  checked: "success",
  attention: "warning",
  failed: "danger",
};

export interface BinderTab {
  id: string;
  name: string;
  count: number;
  hue: BinderHue;
  href: string;
  active: boolean;
}

/**
 * « Le classeur »: a tab per collection with its file count; the address chooses the open one, the default collection (else the
 * first) when it names none or a stale one. The colour is the last check's, never the only signal: the name and the count say it.
 */
export function binderOf<
  C extends {
    id: string;
    name: string;
    files: number;
    isDefault: boolean;
    lastCheck: { status: "checked" | "attention" | "failed" } | null;
  },
>(
  collections: readonly C[],
  chosen: string | null,
  hrefOf: (id: string) => string,
): { tabs: BinderTab[]; selected: C | null } {
  const selected =
    collections.find((c) => c.id === chosen) ?? collections.find((c) => c.isDefault) ?? collections[0] ?? null;
  return {
    tabs: collections.map((c) => ({
      id: c.id,
      name: c.name,
      count: c.files,
      hue: c.lastCheck ? HUE_OF_LAST_CHECK[c.lastCheck.status] : "neutral",
      href: hrefOf(c.id),
      active: c.id === selected?.id,
    })),
    selected,
  };
}

export const STRIP_IDS = ["checks", "toReview", "documents", "files"] as const;
export type StripId = (typeof STRIP_IDS)[number];

export interface StripFigure {
  id: StripId;
  total: number;
  /** One value per day of the period, oldest first: the sparkline. */
  values: number[];
}

/** The activity strip: each figure is the sum of its own series; « files received » exists only with the applicant-file flow. */
export function stripOf(series: Record<StripId, readonly ActivityDay[] | null>): StripFigure[] {
  return STRIP_IDS.flatMap((id) => {
    const days = series[id];
    return days ? [{ id, total: days.reduce((n, d) => n + d.checks, 0), values: days.map((d) => d.checks) }] : [];
  });
}

/** The week chart: the last seven days of the period (all of it when the period is 7 days). */
export const weekOf = (days: readonly ActivityDay[]): ActivityDay[] => days.slice(-7);

export type CreditsFigure =
  | { kind: "included" }
  | { kind: "pro"; used: number; cap: number; renewsAt: string | null; cancelled: boolean }
  | { kind: "credits"; left: number };

/** What the account has, from the billing state: operator-made accounts have their audits included; Pro counts against the fair-use cap; the others have credits (and the free audit while it is unspent). */
export function creditsFigure(e: Entitlement, usedThisMonth: number, perMonthCap: number): CreditsFigure {
  if (!e.selfServe) return { kind: "included" };
  if (e.pro)
    return {
      kind: "pro",
      used: usedThisMonth,
      cap: perMonthCap,
      renewsAt: e.proUntil,
      cancelled: e.cancelsAtPeriodEnd,
    };
  return { kind: "credits", left: e.credits + (e.freeAuditUsed ? 0 : 1) };
}

export type QuickId = "request" | "documents" | "checks" | "search";

/**
 * Where the person goes most, besides « Vérifier un document » (the header's one action, on every screen). « Demander des
 * documents » only where the applicant-file flow is offered: no tile leads nowhere.
 */
export function quickLinks(locale: Locale, applicantFiles: boolean): { id: QuickId; href: string }[] {
  return [
    ...(applicantFiles ? [{ id: "request" as const, href: `/${locale}${CONSOLE_ROUTES.files}` }] : []),
    { id: "documents" as const, href: `/${locale}${CONSOLE_ROUTES.documents}` },
    { id: "checks" as const, href: `/${locale}${CONSOLE_ROUTES.checks}` },
    { id: "search" as const, href: `/${locale}${CONSOLE_ROUTES.search}` },
  ];
}

export const BINDER_KEY = "collection";

/** The home's address: the period always (it is the state), the open tab of the binder once one is chosen. Both live in the address. */
export function homeHref(
  locale: Locale,
  { period, collection }: { period: HomePeriod; collection?: string | null },
): string {
  const params = new URLSearchParams({ [HOME_PERIOD_KEY]: period });
  if (collection) params.set(BINDER_KEY, collection);
  return `/${locale}${CONSOLE_ROUTES.library}?${params.toString()}`;
}
