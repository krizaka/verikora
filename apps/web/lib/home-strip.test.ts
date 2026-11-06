import { describe, expect, it } from "vitest";

import { activityStrip } from "./home";
import { PERIOD_DAYS } from "./home-figures";

/** The strip's figures are queries over the chosen period (verikora#332): the period decides the lower bound, the owner scopes every one. */
const NOW = new Date("2026-10-25T16:00:00Z");

function recorder(rows: Record<string, Date[]>) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const q = (async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return (rows[key ?? ""] ?? []).map((at) => ({ at }));
  }) as never;
  return { q, calls };
}

describe("the activity strip's queries", () => {
  it.each(["7d", "30d", "90d"] as const)(
    "asks each of the four series from the first day of the %s period, for the owner only",
    async (period) => {
      const { q, calls } = recorder({});
      await activityStrip(q, "owner-1", period, NOW, { applicantFiles: true });
      expect(calls).toHaveLength(4);
      for (const call of calls) {
        expect(call.values[0]).toBe("owner-1");
        const from = call.values[1] as Date;
        // one day of slack before the period so its oldest day is whole in Québec
        expect(Math.round((NOW.getTime() - from.getTime()) / 86_400_000)).toBe(PERIOD_DAYS[period] + 1);
      }
    },
  );

  it("buckets each series by day: the figures are the rows of the period, nothing else", async () => {
    const { q } = recorder({
      "FROM analyses": [
        new Date("2026-10-25T12:00:00Z"),
        new Date("2026-10-25T13:00:00Z"),
        new Date("2026-10-24T12:00:00Z"),
        new Date("2026-08-01T12:00:00Z"),
      ],
      "FROM documents": [new Date("2026-10-23T12:00:00Z")],
      "FROM screenings": [new Date("2026-10-22T12:00:00Z")],
    });
    const strip = await activityStrip(q, "o", "7d", NOW, { applicantFiles: true });
    const total = (id: string) => strip[id as keyof typeof strip]?.reduce((n, d) => n + d.checks, 0);
    expect(strip.checks).toHaveLength(7);
    expect(total("checks")).toBe(3);
    expect(total("documents")).toBe(1);
    expect(total("files")).toBe(1);
  });

  it("does not ask for the files without the applicant-file flow", async () => {
    const { q, calls } = recorder({});
    const strip = await activityStrip(q, "o", "30d", NOW, { applicantFiles: false });
    expect(strip.files).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.sql.includes("screenings"))).toBe(false);
  });

  it("the series of the checks to look at uses the same predicate as « À traiter » (the rows Vérifications shows)", async () => {
    const { q, calls } = recorder({});
    await activityStrip(q, "o", "30d", NOW, { applicantFiles: false });
    const toReview = calls.find((c) => c.sql.includes("'cancelled'"));
    expect(toReview?.sql).toContain("(a.report->>'attention')::boolean");
  });
});
