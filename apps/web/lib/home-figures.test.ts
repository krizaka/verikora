import { describe, expect, it } from "vitest";

import { readCheckFilters } from "./check-filters";
import {
  activityOf,
  filesInStates,
  HOME_PERIODS,
  homePeriodOf,
  nothingToDo,
  readFileStates,
  toDoLinks,
} from "./home-figures";

/** The home's figures (verikora#325, P8 of the design direction): each one a door to the view it counts. */
describe("« À traiter »: each figure's link carries its view's filter", () => {
  it("the checks to look at open Vérifications filtered on what needs a look (attention, failed)", () => {
    const link = new URL(toDoLinks("fr").toReview, "https://x.test");
    expect(link.pathname).toBe("/fr/app/verifications");
    expect(readCheckFilters(link.search).result).toEqual(["attention", "failed"]);
  });
  it("the files to decide and the open links open « Dossiers » filtered on that link state", () => {
    const decide = new URL(toDoLinks("en").toDecide, "https://x.test");
    const open = new URL(toDoLinks("en").openLinks, "https://x.test");
    expect([decide.pathname, open.pathname]).toEqual(["/en/app/dossiers", "/en/app/dossiers"]);
    expect(readFileStates(decide.search)).toEqual(["used"]);
    expect(readFileStates(open.search)).toEqual(["open"]);
  });
  it("is one line, « Rien à traiter », when every figure is zero", () => {
    expect(nothingToDo({ toReview: 0, toDecide: 0, openLinks: 0 })).toBe(true);
    expect(nothingToDo({ toReview: 0, toDecide: 1, openLinks: 0 })).toBe(false);
    expect(nothingToDo({ toReview: 2, toDecide: null, openLinks: null })).toBe(false);
    expect(nothingToDo({ toReview: 0, toDecide: null, openLinks: null })).toBe(true);
  });
});

describe("« Dossiers » reads its link-state filter from the address", () => {
  const file = (id: string, status: string) => ({ id, status }) as never;
  it("keeps the known states only, and lists everything without a filter", () => {
    expect(readFileStates("?state=open,nope,used")).toEqual(["open", "used"]);
    expect(readFileStates("")).toEqual([]);
    const files = [file("a", "open"), file("b", "used"), file("c", "closed")];
    expect(filesInStates(files, ["used"]).map((f: { id: string }) => f.id)).toEqual(["b"]);
    expect(filesInStates(files, [])).toHaveLength(3);
  });
});

describe("the activity per period", () => {
  const now = new Date("2026-10-25T03:30:00Z"); // 23:30 on the 24th in Québec
  it("offers 7, 30 and 90 days, 30 by default, from the address", () => {
    expect(HOME_PERIODS).toEqual(["7d", "30d", "90d"]);
    expect([homePeriodOf("7d"), homePeriodOf("90d"), homePeriodOf(null), homePeriodOf("1y")]).toEqual([
      "7d",
      "90d",
      "30d",
      "30d",
    ]);
  });
  it("counts the checks of each day in Québec, oldest first, every day present, nothing outside the period", () => {
    const at = ["2026-10-25T02:00:00Z", "2026-10-24T15:00:00Z", "2026-10-20T12:00:00Z", "2026-10-01T12:00:00Z"];
    const days = activityOf(at, "7d", now);
    expect(days.map((d) => d.day)).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
    expect(days.map((d) => d.checks)).toEqual([0, 0, 1, 0, 0, 0, 2]);
    expect(activityOf(at, "30d", now)).toHaveLength(30);
    expect(activityOf(at, "30d", now).reduce((n, d) => n + d.checks, 0)).toBe(4);
    expect(activityOf([], "90d", now)).toHaveLength(90);
  });
});
