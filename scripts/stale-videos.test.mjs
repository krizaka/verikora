import assert from "node:assert/strict";
import { test } from "vitest";

import { MAX_AGE_DAYS as APP_MAX_AGE_DAYS } from "../apps/web/lib/app-videos";
import { ALERT_KEY, alertFor, MAX_AGE_DAYS, staleVideos } from "./stale-videos-lib.mjs";

const v = (flow, capturedAt) => ({
  platform: "web",
  flow,
  seconds: 5,
  capturedAt,
  files: { webm: "", mp4: "", poster: "" },
});
const NOW = new Date("2026-11-20T00:00:00Z");

test("the watch and the page's helper use the same age", () => {
  assert.equal(MAX_AGE_DAYS, APP_MAX_AGE_DAYS);
});

test("a stale recording raises the alert, naming every stale id", () => {
  const alert = alertFor(NOW, [
    v("old-en", "2026-11-05T00:00:00Z"),
    v("fresh-en", "2026-11-19T00:00:00Z"),
    v("older-fr", "2026-10-31T10:47:29Z"),
  ]);
  assert.equal(alert.state, "red");
  assert.deepEqual(alert.ids, ["web-old-en", "web-older-fr"]);
  assert.match(alert.body, /web-old-en/);
  assert.match(alert.body, /web-older-fr/);
  assert.doesNotMatch(alert.body, /web-fresh-en/);
});

test("fresh recordings clear the alert", () => {
  const alert = alertFor(NOW, [v("a-en", "2026-11-07T00:00:01Z"), v("b-en", "2026-11-20T00:00:00Z")]);
  assert.equal(alert.state, "green");
  assert.deepEqual(alert.ids, []);
});

test("the cutoff is exactly the age: 14 days old is still fresh, one second more is stale", () => {
  assert.deepEqual(staleVideos(NOW, [v("edge-en", "2026-11-06T00:00:00Z")]), []);
  assert.equal(staleVideos(NOW, [v("edge-en", "2026-11-05T23:59:59Z")]).length, 1);
});

test("the alert is one key for the product", () => {
  assert.equal(ALERT_KEY, "stale-videos/verikora");
});
