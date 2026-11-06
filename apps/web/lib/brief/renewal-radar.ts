import {
  type BriefAction,
  type BriefWeek,
  type Detector,
  type Recommendation,
  recommendation,
  type Urgency,
} from "@krizaka/brief";

import { addDays, addMonths, type Day, daysBetween, formatDay, parseDay } from "./calendar";
import type { NoticeWindowRule, TalTable, TalYear } from "./tal";

/**
 * The TAL renewal radar (verikora#228) — Verikora's first detector of the Monday brief, on `@krizaka/brief`. For each lease:
 * the window in which a notice of rent increase may be given (art. 1942 C.c.Q.: between 6 and 3 months before the end of a lease
 * of 12 months or more; the other durations per the table), an alert when it opens, a reminder before it closes, and the increase
 * the TAL's method gives for the year — from the table's figures and the building's own costs, never from a number in code.
 * Informative, not legal advice: the manager decides and sends the notice; Verikora never sends on their behalf.
 */
export interface RadarLease {
  id: string;
  /** What the manager calls it: « 4 1/2, rue Saint-Denis, logement 3 ». */
  door: string;
  /** The end of the lease, as written on it. */
  endDay: string;
  /** The lease's length in months; null when unknown (no window can be told then). */
  durationMonths: number | null;
  /** The rent now, in integer cents per month. */
  rentCents: number;
  /** The building's change in cost for each `cost-per-door` component of the method, in cents per door and per month. */
  costChangeCents?: Readonly<Record<string, number>>;
}

export interface RadarContext {
  week: BriefWeek;
  leases: readonly RadarLease[];
  table: TalTable;
}

export type RenewalKind = "renewal-window-opens" | "renewal-window-closes";

export interface NoticeWindow {
  rule: NoticeWindowRule;
  opens: string;
  closes: string;
}

/** The window of a lease: from `opensMonthsBefore` to `closesMonthsBefore` months before its end — or null when its end or its length is not known. */
export function noticeWindow(
  lease: Pick<RadarLease, "endDay" | "durationMonths">,
  table: TalTable,
): NoticeWindow | null {
  const end = parseDay(lease.endDay);
  const months = lease.durationMonths;
  if (!end || months === null) return null;
  const rule = table.windows.find((w) => months >= w.minMonths && (w.maxMonths === undefined || months <= w.maxMonths));
  if (!rule) return null;
  return {
    rule,
    opens: formatDay(addMonths(end, -rule.opensMonthsBefore)),
    closes: formatDay(addMonths(end, -rule.closesMonthsBefore)),
  };
}

export interface IncreaseFigure {
  year: number;
  increaseCents: number;
  /** The increase as a share of the current rent, in basis points (rounded). */
  increaseBasisPoints: number;
  newRentCents: number;
  /** Where the year's figures were read from, and when they were entered. */
  sourceUrl: string;
  enteredOn: string;
}

export type IncreaseResult =
  { figure: IncreaseFigure } | { missing: "NO_YEAR" | "NO_BUILDING_COST"; year: number; need?: string };

const sumComponents = (entry: TalYear, lease: RadarLease): number | { need: string } => {
  let total = 0;
  for (const c of entry.components) {
    switch (c.kind) {
      case "rate-of-rent":
        total += Math.round((lease.rentCents * c.basisPoints) / 10_000);
        break;
      case "cost-per-door": {
        const change = lease.costChangeCents?.[c.id];
        if (change === undefined) return { need: c.id };
        total += change;
        break;
      }
      default:
        throw new Error("The table has a component this radar does not know");
    }
  }
  return total;
};

/** The increase the TAL's method gives for the year the lease renews in — or why there is no figure (the table has no such year; the building's costs are not entered). */
export function renewalIncrease(lease: RadarLease, table: TalTable): IncreaseResult {
  const end = parseDay(lease.endDay);
  const year = end ? addDays(end, 1).y : 0;
  const entry = table.years.find((y) => y.year === year);
  if (!entry) return { missing: "NO_YEAR", year };
  const total = sumComponents(entry, lease);
  if (typeof total !== "number") return { missing: "NO_BUILDING_COST", year, need: total.need };
  const increaseCents = Math.max(0, total);
  return {
    figure: {
      year,
      increaseCents,
      increaseBasisPoints: lease.rentCents > 0 ? Math.round((increaseCents * 10_000) / lease.rentCents) : 0,
      newRentCents: lease.rentCents + increaseCents,
      sourceUrl: entry.sourceUrl,
      enteredOn: entry.enteredOn,
    },
  };
}

/** What the button does: write the notice, a document the manager sends — payload: the lease, its window, the figure or why there is none, and the source to show. */
export type GenerateNotice = BriefAction<
  "generate-notice",
  {
    leaseId: string;
    window: { opens: string; closes: string; citation: string };
    figure: IncreaseFigure | null;
    missing: string | null;
    source: { url: string };
  }
>;
export type RenewalRecommendation = Recommendation<RenewalKind, GenerateNotice>;

const MONTHS_IN_YEAR = 12;

/** What a window says today: opening this week, or closing within the reminder — the days left either way — or nothing. */
function dueOf(
  window: NoticeWindow,
  today: Day,
  monday: Day,
  reminderDays: number,
): { kind: RenewalKind; urgency: Urgency; daysToClose: number } | null {
  const [opens, closes] = [parseDay(window.opens), parseDay(window.closes)];
  if (!opens || !closes) return null;
  const daysToClose = daysBetween(today, closes);
  const open = daysBetween(opens, today) >= 0 && daysToClose >= 0;
  if (open && daysToClose <= reminderDays) return { kind: "renewal-window-closes", urgency: "now", daysToClose };
  const opensThisWeek = daysBetween(monday, opens) >= 0 && daysBetween(opens, addDays(monday, 6)) >= 0;
  return opensThisWeek ? { kind: "renewal-window-opens", urgency: "week", daysToClose } : null;
}

/** The recommendation of one lease whose window is due: the figure if the table has it, the reason if not, the notice as the one action. */
function recommendLease(
  week: string,
  lease: RadarLease,
  window: NoticeWindow,
  due: { kind: RenewalKind; urgency: Urgency; daysToClose: number },
  table: TalTable,
): RenewalRecommendation {
  const increase = renewalIncrease(lease, table);
  const figure = "figure" in increase ? increase.figure : null;
  return recommendation({
    week,
    kind: due.kind,
    subject: lease.id,
    urgency: due.urgency,
    impactCents: figure ? figure.increaseCents * MONTHS_IN_YEAR : 0,
    figures: {
      rentCents: lease.rentCents,
      daysToClose: due.daysToClose,
      ...(figure
        ? {
            increaseCents: figure.increaseCents,
            increaseBasisPoints: figure.increaseBasisPoints,
            newRentCents: figure.newRentCents,
          }
        : {}),
    },
    assumptions: figure ? ["talMethod", "informative"] : ["noTalFigure", "informative"],
    evidence: [lease.id],
    action: {
      kind: "generate-notice",
      payload: {
        leaseId: lease.id,
        window: { opens: window.opens, closes: window.closes, citation: window.rule.citation },
        figure,
        missing: "missing" in increase ? increase.missing : null,
        source: { url: figure?.sourceUrl ?? table.source.url },
      },
    },
  });
}

/** The detector: pure, deterministic. A window opening this week is told (`week`); an open one closing within the reminder is urgent (`now`). */
export const renewalRadar: Detector<RadarContext, RenewalRecommendation> = ({ week, leases, table }) => {
  const [today, monday] = [parseDay(week.localDate), parseDay(week.monday)];
  if (!today || !monday) return [];
  return leases.flatMap((lease) => {
    const window = noticeWindow(lease, table);
    const due = window ? dueOf(window, today, monday, table.alerts.reminderDays) : null;
    return window && due ? [recommendLease(week.week, lease, window, due, table)] : [];
  });
};
