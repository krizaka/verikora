import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  homePrimaryProblems,
  PAGES,
  railRoutes,
  splitTargetProblems,
  targetCounts,
  targetRatchet,
} from "./check-app-pages.mjs";
import { problemsOf } from "@krizaka/page-audit";

describe("the signed-in pages crawl (yomizaka#457: « Dossiers » crashed unseen, it was in no list)", () => {
  it("audits « Dossiers » and every route the sidebar offers", () => {
    assert.ok(PAGES.includes("/app/dossiers"));
    const rail = [
      "/en/app",
      "/en/app/dossiers",
      "/en/app/documents?x=1",
      "/en/app/verifications",
      "/en/app?period=30d&collection=abc",
      "/fr/app/search",
      "https://x.test/en/app/y",
      "/en/app/settings/",
    ];
    assert.deepEqual(railRoutes(rail, "en"), [
      "/app",
      "/app/dossiers",
      "/app/documents",
      "/app/verifications",
      "/app/settings",
    ]);
  });
  it("a page that rendered its error state is a problem, even with one h1", () => {
    const ok = { h1: 1, scrollWidth: 400, clientWidth: 400, wide: [], unnamedButtons: 0, segmentError: false };
    assert.deepEqual(problemsOf("/app/dossiers @1440 dark", ok, { h1: true }), []);
    assert.match(problemsOf("/app/dossiers @1440 dark", { ...ok, segmentError: true }, { h1: true })[0], /error state/);
  });
  it("a run id wrapped a character per line is a problem (the Checks table)", () => {
    const ok = { h1: 1, scrollWidth: 400, clientWidth: 400, wide: [], unnamedButtons: 0, wrapped: [] };
    assert.deepEqual(problemsOf("/app/verifications @390 dark", ok, { h1: true }), []);
    assert.match(
      problemsOf("/app/verifications @390 dark", { ...ok, wrapped: ["0198f2ab-7c1d-7e"] }, { h1: true })[0],
      /one character per line/,
    );
  });
  it("an empty heading and an unlabelled file input are problems", () => {
    const ok = { h1: 1, scrollWidth: 400, clientWidth: 400, wide: [], unnamedButtons: 0 };
    assert.deepEqual(problemsOf("/app/settings/profil @1440 dark", ok, { h1: true }), []);
    assert.match(
      problemsOf("/app/settings/profil @1440 dark", { ...ok, emptyHeadings: 2 }, { h1: true })[0],
      /empty heading/,
    );
    assert.match(
      problemsOf("/app/check @1440 dark", { ...ok, unlabelledFiles: 1 }, { h1: true, fileLabels: true })[0],
      /file input/,
    );
  });
});

describe("the home's first screen offers the primary action as a button (krizaka-internal#2001)", () => {
  const ok = { role: "link", name: "Check a document", visible: true, inFirstScreen: true };
  it("passes with the named button on the first screen", () => {
    assert.deepEqual(homePrimaryProblems("/app @390 dark", ok, "Check a document"), []);
  });
  it("fails when the button is missing, below the fold or misnamed", () => {
    assert.equal(homePrimaryProblems("/app @390 dark", null, "Check a document").length, 1);
    assert.equal(homePrimaryProblems("/app @390 dark", { ...ok, inFirstScreen: false }, "Check a document").length, 1);
    assert.equal(homePrimaryProblems("/app @390 dark", { ...ok, name: "Go" }, "Check a document").length, 1);
    assert.equal(homePrimaryProblems("/app @390 dark", { ...ok, role: "div" }, "Check a document").length, 1);
  });
});

describe("the touch-target ratchet (krizaka-internal#1903)", () => {
  const t = (route, w) => `${route} @${w} dark: touch target under 44 px (a.x 20x20)`;
  it("splits the target findings from the other problems", () => {
    const { targets, others } = splitTargetProblems([t("/app", 360), "/app @360 dark: no h1"]);
    assert.equal(targets.length, 1);
    assert.deepEqual(others, ["/app @360 dark: no h1"]);
  });
  it("counts per route", () => {
    assert.deepEqual(
      targetCounts([
        t("/app", 360),
        t("/app", 390),
        `/app/check @360 dark: touch target under 44 px (a.x 20x20, b.y 30x30)`,
      ]),
      { "/app": 2, "/app/check": 2 },
    );
  });
  it("keys a record's route by its shape: an id changes at every seed", () => {
    const id = (n) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
    const counts = targetCounts([t(`/app/dossiers/${id(1)}`, 360), t(`/app/dossiers/${id(2)}`, 360)]);
    assert.deepEqual(counts, { "/app/dossiers/<id>": 2 });
    assert.equal(targetRatchet([t(`/app/dossiers/${id(3)}`, 360)], { "/app/dossiers/<id>": 1 }).problems.length, 0);
  });
  it("fails on a route above its baseline or absent from it, and reports gains", () => {
    const targets = [t("/app", 360), t("/app", 390), t("/app/check", 360)];
    assert.equal(targetRatchet(targets, { "/app": 2, "/app/check": 1 }).problems.length, 0);
    assert.equal(targetRatchet(targets, { "/app": 1, "/app/check": 1 }).problems.length, 1);
    assert.equal(targetRatchet(targets, { "/app": 2 }).problems.length, 1);
    assert.deepEqual(targetRatchet([t("/app", 360)], { "/app": 2 }).gains, ["/app"]);
  });
});
