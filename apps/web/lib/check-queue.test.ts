import { describe, expect, it } from "vitest";

import { CHECK_STAGES, checkDefaults, checkRows, FLOW_STEPS, flowStep, opensAtOnce, reportHref } from "./check-queue";

/** The check flow's logic (verikora#326, P9 of the design direction § 5.4). */
describe("the defaults, named before the drop (Errata 6)", () => {
  it("say where the file goes, whether it is kept, and which rules apply, in that order", () => {
    expect(checkDefaults({ keep: false, keepOff: false })).toEqual([
      "check.defaults.erased",
      "check.defaults.rules",
      "check.defaults.place",
    ]);
    expect(checkDefaults({ keep: true, keepOff: false })[0]).toBe("check.defaults.kept");
    // The owner turned keeping off: the file is erased, whatever the tick says.
    expect(checkDefaults({ keep: true, keepOff: true })[0]).toBe("check.defaults.erased");
  });
});

describe("the queue's rows", () => {
  const doc = (id: string) => ({ id, filename: `${id}.pdf` });
  it("move through words, never a bare bar: every stage has its own message", () => {
    expect(CHECK_STAGES).toEqual(["reading", "starting", "asking", "started", "refused"]);
  });
  it("a confident kind starts on the drop; an uncertain one asks, for that file only; a refusal keeps its code", () => {
    let rows = checkRows([], { type: "landed", document: doc("a") });
    rows = checkRows(rows, { type: "landed", document: doc("b") });
    rows = checkRows(rows, { type: "landed", document: doc("c") });
    expect(rows.map((r) => r.stage)).toEqual(["reading", "reading", "reading"]);
    rows = checkRows(rows, { type: "outcome", id: "a", outcome: { started: true, refused: null }, requested: "auto" });
    rows = checkRows(rows, { type: "outcome", id: "b", outcome: { started: false, refused: null }, requested: "auto" });
    rows = checkRows(rows, {
      type: "outcome",
      id: "c",
      outcome: { started: false, refused: "PAYWALL" },
      requested: "auto",
    });
    expect(rows.map((r) => [r.id, r.stage, r.refused])).toEqual([
      ["a", "started", null],
      ["b", "asking", null],
      ["c", "refused", "PAYWALL"],
    ]);
    rows = checkRows(rows, { type: "picked", id: "b" });
    expect(rows.find((r) => r.id === "b")?.stage).toBe("starting");
  });
  it("a kind named in the address that did not start goes to the report tab, which confirms it (never asked twice)", () => {
    const rows = checkRows(checkRows([], { type: "landed", document: doc("a") }), {
      type: "outcome",
      id: "a",
      outcome: { started: false, refused: null },
      requested: "lease",
    });
    expect(rows[0]?.stage).toBe("started");
  });
  it("a file landing twice (a duplicate) keeps one row", () => {
    expect(
      checkRows(checkRows([], { type: "landed", document: doc("a") }), { type: "landed", document: doc("a") }),
    ).toHaveLength(1);
  });
});

describe("where a row leads", () => {
  it("opens the report at once for a single file; with several, each row links to its report", () => {
    expect(opensAtOnce(1)).toBe(true);
    expect(opensAtOnce(3)).toBe(false);
    expect(reportHref("fr", { id: "a", refused: null })).toBe("/fr/app/documents/a/rapport");
    expect(reportHref("en", { id: "a", refused: "PAYWALL" })).toBe("/en/app/documents/a/rapport?refused=PAYWALL");
  });
});

describe("the flow's step (krizaka-internal#1899)", () => {
  const rows = (...stages: Array<(typeof CHECK_STAGES)[number]>) => stages.map((stage) => ({ stage }));
  it("goes drop, kind, running, result, in that order", () => {
    expect(FLOW_STEPS).toEqual(["drop", "kind", "running", "result"]);
  });
  it("is drop with nothing dropped and result once every file is under way or refused", () => {
    expect(flowStep([])).toBe("drop");
    expect(flowStep(rows("started", "refused"))).toBe("result");
  });
  it("puts the question first: a file waiting for its kind outranks one still running", () => {
    expect(flowStep(rows("reading", "asking"))).toBe("kind");
    expect(flowStep(rows("starting", "started"))).toBe("running");
  });
});
