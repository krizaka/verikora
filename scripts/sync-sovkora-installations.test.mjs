import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { compareVersions, plan, syncInstallations } from "./sync-sovkora-installations.mjs";

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("versions compare as numbers, not text", () => {
  assert.equal(compareVersions("1.4.0", "2.0.0"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("2.0.0", "2.0"), 0);
});

test("plans an upgrade, a keep and an install", () => {
  const installed = [
    { id: "i1", studioKey: "compliance-check", pinnedVersion: "1.4.0" },
    { id: "i2", studioKey: "b", pinnedVersion: "3.0.0" },
  ];
  assert.deepEqual(
    plan({ "compliance-check": "2.0.0", b: "2.0.0", c: "1.0.0" }, installed).map((s) => s.action),
    ["upgrade", "keep", "install"],
  );
});

test("the list wants compliance-check 2.0.0 (the declared kind of a visit notice and an état des lieux)", () => {
  assert.equal(
    JSON.parse(readFileSync(new URL("./sovkora-installations.json", import.meta.url), "utf8")).studios[
      "compliance-check"
    ],
    "2.0.0",
  );
});

test("upgrades through the documented endpoint, and does nothing on --check", async () => {
  const calls = [];
  const impl = async (url, init = {}) => {
    const pathname = new URL(url).pathname.replace(/^\/edge/, "");
    calls.push(`${init.method ?? "GET"} ${pathname}`);
    if (pathname === "/api/v1/studios/installations")
      return json(200, [{ id: "i1", studioKey: "compliance-check", pinnedVersion: "1.4.0" }]);
    if (pathname === "/api/v1/studios/installations/i1/upgrade")
      return json(200, { id: "i1", studioKey: "compliance-check", pinnedVersion: "2.0.0" });
    return json(404, {});
  };
  const wanted = { "compliance-check": "2.0.0" };
  const log = () => {};
  assert.equal(
    (await syncInstallations({ base: "https://x/edge", token: "t", wanted, check: true, fetchImpl: impl, log })).behind,
    1,
  );
  assert.deepEqual(calls, ["GET /api/v1/studios/installations"]);
  await syncInstallations({ base: "https://x/edge", token: "t", wanted, fetchImpl: impl, log });
  assert.ok(calls.includes("POST /api/v1/studios/installations/i1/upgrade"));
});

test("fails when Sovkora refuses, with the status only", async () => {
  await assert.rejects(
    syncInstallations({
      base: "https://x",
      token: "t",
      wanted: {},
      fetchImpl: async () => json(401, {}),
      log: () => {},
    }),
    /answered 401 on GET/,
  );
});
