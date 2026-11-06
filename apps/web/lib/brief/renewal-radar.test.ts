import { composeBrief, weekOf } from "@krizaka/brief";
import { describe, expect, it } from "vitest";

import { addDays, addMonths, daysBetween, epochDay, formatDay, parseDay } from "./calendar";
import { renewalNotice } from "./renewal-notice";
import { noticeWindow, type RadarContext, type RadarLease, renewalIncrease, renewalRadar } from "./renewal-radar";
import { TAL, type TalTable, talTable } from "./tal";

const day = (text: string) => parseDay(text)!;
const table = (over: Partial<TalTable> = {}): TalTable => ({ ...TAL, ...over });
/** TEST FIGURES — invented for these tests, never shipped: the shipped table has no year until someone enters the TAL's figures. */
const withYear: TalTable = table({
  years: [
    {
      year: 2027,
      enteredOn: "2026-10-26",
      sourceUrl: "https://example.test/tal-2027",
      components: [
        { id: "adjustment", kind: "rate-of-rent", basisPoints: 300 },
        { id: "taxes", kind: "cost-per-door" },
      ],
    },
  ],
});
const lease = (over: Partial<RadarLease> = {}): RadarLease => ({
  id: "lease-1",
  door: "4 1/2, rue Saint-Denis, logement 3",
  endDay: "2027-06-30",
  durationMonths: 12,
  rentCents: 100_000,
  costChangeCents: { taxes: 1_500 },
  ...over,
});
/** The week the instant falls in, for Québec. */
const ctx = (instant: string, leases: RadarLease[], t: TalTable = TAL): RadarContext => ({
  week: weekOf(new Date(instant), "America/Montreal"),
  leases,
  table: t,
});

describe("calendar days", () => {
  it("counts months from the day, clamped to the month's last day, leap years included", () => {
    expect(formatDay(addMonths(day("2027-08-31"), -6))).toBe("2027-02-28");
    expect(formatDay(addMonths(day("2028-08-31"), -6))).toBe("2028-02-29");
    expect(formatDay(addMonths(day("2027-06-30"), -3))).toBe("2027-03-30");
    expect(formatDay(addMonths(day("2027-05-31"), -3))).toBe("2027-02-28");
    expect(formatDay(addMonths(day("2027-01-31"), -2))).toBe("2026-11-30");
    expect(formatDay(addMonths(day("2026-12-15"), 1))).toBe("2027-01-15");
  });

  it("counts days across a leap day, and walks back from a day number", () => {
    expect(daysBetween(day("2028-02-28"), day("2028-03-01"))).toBe(2);
    expect(daysBetween(day("2027-02-28"), day("2027-03-01"))).toBe(1);
    expect(epochDay(day("1970-01-01"))).toBe(0);
    for (const text of ["2026-12-31", "2028-02-29", "2000-03-01", "2027-06-30"]) {
      expect(formatDay(addDays(day(text), 0))).toBe(text);
      expect(formatDay(addDays(addDays(day(text), 400), -400))).toBe(text);
    }
    expect(formatDay(addDays(day("2027-06-30"), 1))).toBe("2027-07-01");
  });

  it("refuses what is not a day", () => {
    for (const bad of ["2027-02-30", "2027-13-01", "27-1-1", "", "2027-06-31"]) expect(parseDay(bad)).toBeNull();
  });
});

describe("the notice window (art. 1942 C.c.Q.)", () => {
  it("is between 6 and 3 months before the end of a lease of 12 months or more", () => {
    expect(noticeWindow(lease(), TAL)).toMatchObject({
      opens: "2026-12-30",
      closes: "2027-03-30",
      rule: { id: "twelve-months-or-more" },
    });
    expect(noticeWindow(lease({ durationMonths: 24 }), TAL)).toMatchObject({
      opens: "2026-12-30",
      closes: "2027-03-30",
    });
  });

  it("clamps at the end of a month and in a leap year", () => {
    expect(noticeWindow(lease({ endDay: "2027-08-31" }), TAL)).toMatchObject({
      opens: "2027-02-28",
      closes: "2027-05-31",
    });
    expect(noticeWindow(lease({ endDay: "2028-08-31" }), TAL)).toMatchObject({
      opens: "2028-02-29",
      closes: "2028-05-31",
    });
  });

  it("is between 2 and 1 month before the end of a shorter lease", () => {
    expect(noticeWindow(lease({ endDay: "2027-01-31", durationMonths: 6 }), TAL)).toMatchObject({
      opens: "2026-11-30",
      closes: "2026-12-31",
      rule: { id: "under-twelve-months" },
    });
  });

  it("is told for no lease whose end or length is not known", () => {
    expect(noticeWindow(lease({ durationMonths: null }), TAL)).toBeNull();
    expect(noticeWindow(lease({ endDay: "not a day" }), TAL)).toBeNull();
    expect(noticeWindow(lease({ durationMonths: 0 }), TAL)).toBeNull();
  });
});

describe("the recommended increase — the TAL's method from data", () => {
  it("is the rate of the rent plus the building's cost, in whole cents, with the source of the year", () => {
    const result = renewalIncrease(lease(), withYear);
    expect(result).toEqual({
      figure: {
        year: 2027,
        increaseCents: 3_000 + 1_500,
        increaseBasisPoints: 450,
        newRentCents: 104_500,
        sourceUrl: "https://example.test/tal-2027",
        enteredOn: "2026-10-26",
      },
    });
  });

  it("gives no figure when the table has no entry for the year the lease renews in", () => {
    expect(renewalIncrease(lease(), TAL)).toEqual({ missing: "NO_YEAR", year: 2027 });
    expect(renewalIncrease(lease({ endDay: "2028-06-30" }), withYear)).toEqual({ missing: "NO_YEAR", year: 2028 });
  });

  it("gives no figure when the building's own cost is not entered, and names it", () => {
    expect(renewalIncrease(lease({ costChangeCents: undefined }), withYear)).toEqual({
      missing: "NO_BUILDING_COST",
      year: 2027,
      need: "taxes",
    });
  });

  it("renews in the year after the last day of the lease: one ending on the 31st of December renews next year", () => {
    expect(renewalIncrease(lease({ endDay: "2026-12-31" }), withYear)).toMatchObject({ figure: { year: 2027 } });
    expect(renewalIncrease(lease({ endDay: "2027-12-31" }), withYear)).toEqual({ missing: "NO_YEAR", year: 2028 });
  });

  it("never lets the cost go below nothing: a fall in costs is no increase", () => {
    const fall = renewalIncrease(lease({ costChangeCents: { taxes: -9_000 } }), withYear);
    expect(fall).toMatchObject({ figure: { increaseCents: 0, increaseBasisPoints: 0, newRentCents: 100_000 } });
  });

  it("the table shipped has no figure of its own: nothing is invented", () => {
    expect(TAL.years).toEqual([]);
    expect(TAL.source.url).toMatch(/^https:\/\/www\.tal\.gouv\.qc\.ca\//);
    expect(() =>
      talTable.parse({
        ...TAL,
        years: [{ year: 2027, enteredOn: "2026-10-26", components: [{ id: "x", kind: "cost-per-door" }] }],
      }),
    ).toThrow();
  });
});

describe("the detector", () => {
  it("tells the week a window opens, once, with its stable id", () => {
    // The window of lease-1 opens on Wednesday 2026-12-30; that week's Monday is 2026-12-28.
    const [item] = renewalRadar(ctx("2026-12-29T14:00:00Z", [lease()]));
    expect(item).toMatchObject({
      kind: "renewal-window-opens",
      urgency: "week",
      subject: "lease-1",
      id: "2026-W53:renewal-window-opens:lease-1",
      figures: { rentCents: 100_000, daysToClose: 91 },
      evidence: ["lease-1"],
    });
    expect(item!.action).toMatchObject({
      kind: "generate-notice",
      payload: {
        leaseId: "lease-1",
        window: { opens: "2026-12-30", closes: "2027-03-30", citation: "C.c.Q., art. 1942" },
      },
    });
    expect(renewalRadar(ctx("2027-01-12T14:00:00Z", [lease()]))).toEqual([]);
  });

  it("opens on the first day of the week, and on the last", () => {
    expect(renewalRadar(ctx("2026-12-28T15:00:00Z", [lease()]))).toHaveLength(1);
    expect(renewalRadar(ctx("2027-01-03T15:00:00Z", [lease()]))).toHaveLength(1);
    expect(renewalRadar(ctx("2026-12-27T15:00:00Z", [lease()]))).toHaveLength(0);
    expect(renewalRadar(ctx("2027-01-04T15:00:00Z", [lease()]))).toHaveLength(0);
  });

  it("reminds before the window closes: urgent from the reminder's days, until the last day", () => {
    const at = (instant: string) => renewalRadar(ctx(instant, [lease()]))[0];
    expect(at("2027-03-15T15:00:00Z")).toBeUndefined();
    expect(at("2027-03-16T15:00:00Z")).toMatchObject({
      kind: "renewal-window-closes",
      urgency: "now",
      figures: { daysToClose: 14 },
    });
    expect(at("2027-03-30T15:00:00Z")).toMatchObject({ kind: "renewal-window-closes", figures: { daysToClose: 0 } });
    expect(at("2027-03-31T15:00:00Z")).toBeUndefined();
  });

  it("is silent while the window is not near anything, and once it has closed", () => {
    for (const instant of ["2026-06-01T15:00:00Z", "2027-02-02T15:00:00Z", "2027-05-01T15:00:00Z"])
      expect(renewalRadar(ctx(instant, [lease()]))).toEqual([]);
  });

  it("gives the figure and its source when the table has them, and says what is missing when it has not", () => {
    const [withFigure] = renewalRadar(ctx("2026-12-29T14:00:00Z", [lease()], withYear));
    expect(withFigure).toMatchObject({
      impactCents: 4_500 * 12,
      figures: { increaseCents: 4_500, increaseBasisPoints: 450, newRentCents: 104_500 },
      assumptions: ["talMethod", "informative"],
    });
    expect(withFigure!.action.payload).toMatchObject({
      missing: null,
      source: { url: "https://example.test/tal-2027" },
    });
    const [none] = renewalRadar(ctx("2026-12-29T14:00:00Z", [lease()]));
    expect(none).toMatchObject({ impactCents: 0, assumptions: ["noTalFigure", "informative"] });
    expect(none!.figures).not.toHaveProperty("increaseCents");
    expect(none!.action.payload).toMatchObject({ figure: null, missing: "NO_YEAR", source: { url: TAL.source.url } });
  });

  it("skips a lease whose window cannot be told, and is deterministic", () => {
    const leases = [lease({ id: "a", durationMonths: null }), lease({ id: "b" })];
    const first = renewalRadar(ctx("2026-12-29T14:00:00Z", leases));
    expect(first.map((i) => i.subject)).toEqual(["b"]);
    expect(renewalRadar(ctx("2026-12-29T14:00:00Z", leases))).toEqual(first);
  });

  it("goes through the brief: a closing window outranks an opening one", () => {
    // 2026-12-29 (week of Monday the 28th): `opening` opens on the 30th; `closing` (ends 2027-04-05) closes on 2027-01-05, in 7 days.
    const instant = "2026-12-29T14:00:00Z";
    const week = weekOf(new Date(instant), "America/Montreal");
    const brief = composeBrief({
      week: week.week,
      ctx: ctx(instant, [lease({ id: "opening" }), lease({ id: "closing", endDay: "2027-04-05" })]),
      detectors: [renewalRadar],
    });
    expect(brief.items.map((i) => [i.subject, i.kind, i.urgency])).toEqual([
      ["closing", "renewal-window-closes", "now"],
      ["opening", "renewal-window-opens", "week"],
    ]);
  });
});

describe("the notice the manager sends", () => {
  const input = {
    door: "4 1/2, rue Saint-Denis, logement 3",
    endDay: "2027-06-30",
    rentCents: 100_000,
    newRentCents: 104_500,
    window: { opens: "2026-12-30", closes: "2027-03-30", citation: "C.c.Q., art. 1942" },
  };

  it("names the dwelling, the rents, the day the new rent starts and the window, in French and in English", () => {
    const fr = renewalNotice(input, "fr");
    expect(fr.text).toContain("4 1/2, rue Saint-Denis, logement 3");
    expect(fr.text).toMatch(/1\s000,00\s\$/);
    expect(fr.text).toMatch(/1\s045,00\s\$/);
    expect(fr.text).toMatch(/1(er)? juillet 2027/);
    expect(fr.text).toContain("C.c.Q., art. 1942");
    const en = renewalNotice(input, "en");
    expect(en.text).toContain("July 1, 2027");
    expect(en.text).toContain("$1,045.00");
  });

  it("leaves the proposed rent blank when the TAL's figures are not entered", () => {
    expect(renewalNotice({ ...input, newRentCents: null }, "en").text).toContain(
      "Proposed rent: ____________ a month, from July 1, 2027.",
    );
  });

  it("is information the landlord signs and sends: it never says compliant, approved or that Verikora sends it", () => {
    for (const locale of ["fr", "en"] as const) {
      const { text } = renewalNotice(input, locale);
      expect(text).not.toMatch(/conforme|compliant|approuv|approved/i);
      expect(text).toMatch(/pas un avis juridique|not legal advice/);
    }
  });
});
