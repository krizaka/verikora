import { subDays } from "date-fns";

import { listApplicantFiles } from "./applicant-file";
import { LINK } from "./applicant-file-rules";
import type { StripId } from "./home-b2";
import { type ActivityDay, activityOf, type HomePeriod, PERIOD_DAYS, type ToDo } from "./home-figures";
import type { Query } from "./organisation/store";

/*
 * The home's queries (verikora#325, P8): « À traiter » and the activity of a period, each figure counted by a query over
 * the same rows its view lists, never a counter kept aside.
 */

// The checks « to look at »: the rows Vérifications shows under `result=attention,failed` (lib/documents `documentStatus`).
const NEEDS_A_LOOK =
  "(a.status IN ('failed', 'cancelled') OR (a.status = 'succeeded' AND coalesce((a.report->>'attention')::boolean, false)))";
const TO_REVIEW = `SELECT count(*)::int AS n
     FROM analyses a JOIN documents d ON d.id = a.document_id
    WHERE d.owner_id = $1
      AND ${NEEDS_A_LOOK}`;

// A day more than the period, so the oldest day is whole in Québec; activityOf keeps the period's days only.
const SLACK_DAYS = 1;

/** « À traiter »: the checks to look at, and — with the applicant-file flow — the files to decide and the open links. */
export async function toDo(
  q: Query,
  owner: string,
  now: Date,
  { applicantFiles }: { applicantFiles: boolean },
): Promise<ToDo> {
  const [[review], files] = await Promise.all([
    q<{ n: number }>(TO_REVIEW, [owner]),
    applicantFiles ? listApplicantFiles(owner, now) : Promise.resolve(null),
  ]);
  if (!files) return { toReview: review?.n ?? 0, toDecide: null, openLinks: null, nextExpiry: null };
  const open = files.filter((f) => f.status === LINK.open);
  return {
    toReview: review?.n ?? 0,
    toDecide: files.filter((f) => f.status === LINK.used).length,
    openLinks: open.length,
    // ISO instants in UTC compare as text: the earliest is the first to expire.
    nextExpiry: open.reduce<string | null>(
      (first, f) => (first === null || f.expiresAt < first ? f.expiresAt : first),
      null,
    ),
  };
}

/**
 * The files the candidate sent and nobody decided: the rail's badge on « Dossiers » (B2, P14). The same rows as « À traiter »'s
 * « Dossiers à décider » (link state `used`: sent, not closed, not revoked, not expired, not erased — `linkState`), counted by one
 * query, not by listing the files.
 */
export async function filesToDecide(q: Query, owner: string, now: Date): Promise<number> {
  const [row] = await q<{ n: number }>(
    "SELECT count(*)::int AS n FROM screenings e WHERE e.landlord_id = $1 AND e.flow = 'file' AND e.status <> 'erased' AND e.submitted_at IS NOT NULL AND e.closed_at IS NULL AND e.revoked_at IS NULL AND e.expires_at > $2",
    [owner, now],
  );
  return row?.n ?? 0;
}

/** The checks of each day of the period, from the moments they ended (or started, while they run). */
export async function activity(q: Query, owner: string, period: HomePeriod, now: Date): Promise<ActivityDay[]> {
  const rows = await q<{ at: Date }>(
    `SELECT coalesce(a.finished_at, a.created_at) AS at
       FROM analyses a JOIN documents d ON d.id = a.document_id
      WHERE d.owner_id = $1 AND coalesce(a.finished_at, a.created_at) >= $2`,
    [owner, subDays(now, PERIOD_DAYS[period] + SLACK_DAYS)],
  );
  return activityOf(
    rows.map((r) => r.at),
    period,
    now,
  );
}

/**
 * The activity strip's four series over the period (verikora#332), each a query over the rows it counts: the checks run, those to
 * look at (the predicate of « À traiter »), the documents added and — with the applicant-file flow — the files received. Every
 * one is bucketed by Québec day with `activityOf`; the figure is the sum of its days.
 */
export async function activityStrip(
  q: Query,
  owner: string,
  period: HomePeriod,
  now: Date,
  { applicantFiles }: { applicantFiles: boolean },
): Promise<Record<Exclude<StripId, "files">, ActivityDay[]> & { files: ActivityDay[] | null }> {
  const from = subDays(now, PERIOD_DAYS[period] + SLACK_DAYS);
  const series = async (sql: string): Promise<ActivityDay[]> =>
    activityOf(
      (await q<{ at: Date }>(sql, [owner, from])).map((r) => r.at),
      period,
      now,
    );
  const [checks, toReview, documents, files] = await Promise.all([
    series(
      "SELECT coalesce(a.finished_at, a.created_at) AS at FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND coalesce(a.finished_at, a.created_at) >= $2",
    ),
    series(
      `SELECT coalesce(a.finished_at, a.created_at) AS at FROM analyses a JOIN documents d ON d.id = a.document_id WHERE d.owner_id = $1 AND coalesce(a.finished_at, a.created_at) >= $2 AND ${NEEDS_A_LOOK}`,
    ),
    series("SELECT created_at AS at FROM documents WHERE owner_id = $1 AND created_at >= $2"),
    applicantFiles
      ? series(
          "SELECT submitted_at AS at FROM screenings WHERE landlord_id = $1 AND flow = 'file' AND submitted_at >= $2",
        )
      : Promise.resolve(null),
  ]);
  return { checks, toReview, documents, files };
}
