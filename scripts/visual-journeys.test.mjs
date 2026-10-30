// The journey of the hydrated first paint (app-home-pending) flaked on a shot that was right: two things moved under it.
//  - the date in words (« Today ») is written by the SERVER's clock, which the browser's frozen clock does not reach, and the masked
//    box takes the width of its text: « vendredi 30 octobre 2026 » (24 letters) one day, « jeudi 29 octobre 2026 » (21) the next;
//  - the account mark swaps its initial for the default picture once the image is decoded: a shot taken a few frames earlier shows the initial.
// Both are settled before the shot, in `ready`, so a day or a slow runner cannot change the capture.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it as test } from "vitest";

const source = readFileSync(new URL("../apps/web/e2e/visual/journeys.visual.mjs", import.meta.url), "utf8");
const pending = source.split("\n").find((line) => line.includes('name: "app-home-pending"')) ?? "";

test("the pending first paint settles the date and the account picture before the shot", () => {
  assert.match(pending, /ready: settleHeaderLive/, "the pending journey must run settleHeaderLive");
  const body = source.slice(source.indexOf("async function settleHeaderLive"));
  assert.match(body, /data-testid="today"/, "waits for the date box (the server froze its text: APP_VISUAL_NOW)");
  assert.match(body, /naturalWidth/, "waits for the account picture to be decoded");
});

test("the library gives the dates of its rows one width, by style (the table sizes its columns from their box)", () => {
  const documents = source.split("\n").find((line) => line.includes('name: "documents"')) ?? "";
  assert.match(documents, /ready: fixListDates/, "the documents journey must run fixListDates");
  const body = source.slice(source.indexOf("async function fixListDates"));
  // A style, not a text swap: the page re-renders its dates after hydration and gave the swapped text back on some runs
  // (the « Ajouté » column was 98 px wide on one run, 81 px on the next: yomizaka#641).
  assert.match(body, /addStyleTag/, "the width is a stylesheet the page cannot rewrite");
  assert.match(body, /inline-block/, "the date box has a fixed width of its own");
  assert.doesNotMatch(body, /replaceChildren\(/, "no text swap: it raced the page's own rendering");
});
