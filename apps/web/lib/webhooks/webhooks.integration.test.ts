import { readFileSync } from "node:fs";

import { EVENT_ID_HEADER, EVENT_TYPE_HEADER, type Send, SIGNATURE_HEADER, verifySignature } from "@krizaka/webhooks";
import type { RunPayload } from "@verikora/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as deliveriesRoute } from "@/app/api/me/webhooks/[id]/deliveries/route";
import { POST as rotateRoute } from "@/app/api/me/webhooks/[id]/rotate/route";
import { DELETE as removeRoute, PATCH as patchRoute } from "@/app/api/me/webhooks/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/me/webhooks/route";

import { setBatchObserver } from "../batch/observer";
import { advanceBatch, createBatch } from "../batch/run";
import { migrate, pool, query } from "../db";
import { sessionSecret } from "../env";
import { seedDatabase } from "../flows";
import { cleanPdf } from "../preflight/fixtures";
import { createSession, SESSION_COOKIE } from "../session";
import { settingsFor } from "../settings/guards";
import { appSettings, resetAppSettings } from "../settings/instance";
import { GLOBAL } from "../settings/service";
import { useSovkoraClient } from "../sovkora";
import { deliverWebhooks, registerBatchWebhooks } from "./emit";

/** Signed webhooks end to end (verikora#241) against PostgreSQL: the routes, a batch closing, the signed delivery, the retry. CI's service; locally DATABASE_IT=1 DATABASE_URL=…. */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const REPORT = readFileSync(new URL("../fixtures/sovkora-compliance-qc-1.2.0.json", import.meta.url), "utf8");
// The routes seal with the server's session secret; the delivery loop must open with the same one.
const SERVER_SECRET = sessionSecret();

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe.runIf(enabled)("webhooks", () => {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const actor = { id: null, label: "test" };
  const runs = new Map<string, string>();
  let n = 0;
  const run = (id: string): RunPayload => ({
    id,
    studioKey: "compliance-check",
    blueprintVersion: "1.0.0",
    status: runs.get(id) ?? "RUNNING",
    outputs: runs.get(id) === "SUCCEEDED" ? [{ key: "report", type: "JSON", value: REPORT }] : [],
  });
  let pro = { id: "", perspective: null };
  let free = { id: "", perspective: null };
  let proToken = "";
  let freeToken = "";
  const as = (token: string, method: string, path: string, body?: unknown) =>
    new Request(`http://localhost${path}`, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const account = async (label: string, isPro: boolean) => {
    const [row] = await query<{ id: string }>(
      isPro
        ? "INSERT INTO accounts (email, plan, subscription_status, current_period_end) VALUES ($1, 'PRO', 'active', now() + interval '30 days') RETURNING id"
        : "INSERT INTO accounts (email) VALUES ($1) RETURNING id",
      [`hooks-${label}-${stamp}@verikora.test`],
    );
    return {
      id: row!.id,
      perspective: null,
      token: (await createSession(row!.id, { ip: "203.0.113.20", userAgent: "vitest" })).token,
    };
  };
  const pdf = async (name: string, text: string) => ({ name, type: "application/pdf", bytes: await cleanPdf(text) });
  const closeBatch = async (name: string) => {
    const created = await createBatch(
      pro,
      name,
      `file,check,reference\n${name}.pdf,compliance,REF-${name}`,
      [await pdf(`${name}.pdf`, `BAIL ${name} ${stamp}`)],
      { settings: await settingsFor(pro.id), now: new Date(), environment: "dev" },
    );
    runs.forEach((_, id) => runs.set(id, "SUCCEEDED"));
    return advanceBatch(pro, created.id, { settings: await settingsFor(pro.id), now: new Date(), environment: "dev" });
  };

  beforeAll(async () => {
    await migrate();
    await seedDatabase();
    useSovkoraClient({
      startRun: async () => {
        const id = `run-hook-${stamp}-${++n}`;
        runs.set(id, "RUNNING");
        return run(id);
      },
      getRun: async (id: string) => run(id),
    } as never);
    const a = await account("pro", true);
    pro = { id: a.id, perspective: null };
    proToken = a.token;
    const b = await account("free", false);
    free = { id: b.id, perspective: null };
    freeToken = b.token;
    registerBatchWebhooks(SERVER_SECRET);
  });
  afterAll(async () => {
    setBatchObserver(null);
    useSovkoraClient(null);
    await appSettings().reset(actor, GLOBAL, "features.webhooks", new Date());
    resetAppSettings();
    await query("DELETE FROM accounts WHERE id = ANY($1)", [[pro.id, free.id]]);
    await pool().end();
  });

  it("the free plan has no webhooks; a Pro account registers an endpoint — https and public only — and sees its secret once", async () => {
    const refused = await createRoute(
      as(freeToken, "POST", "/api/me/webhooks", { url: "https://hooks.example.test/a", events: ["batch.finished"] }),
    );
    expect([refused.status, (await refused.json()).code]).toEqual([403, "WEBHOOK_PLAN"]);

    for (const url of [
      "http://hooks.example.test/a",
      "https://127.0.0.1/a",
      "https://user:pw@hooks.example.test/a",
      "not a url",
    ]) {
      const bad = await createRoute(as(proToken, "POST", "/api/me/webhooks", { url, events: ["batch.finished"] }));
      expect([bad.status, (await bad.json()).code], url).toEqual([400, "WEBHOOK_URL"]);
    }
    const unknown = await createRoute(
      as(proToken, "POST", "/api/me/webhooks", { url: "https://hooks.example.test/a", events: ["nope"] }),
    );
    expect([unknown.status, (await unknown.json()).code]).toEqual([400, "WEBHOOK_EVENTS"]);

    const made = await createRoute(
      as(proToken, "POST", "/api/me/webhooks", {
        url: "https://hooks.example.test/verikora",
        events: ["batch.finished", "check.finished"],
      }),
    );
    expect(made.status).toBe(201);
    expect(made.headers.get("cache-control")).toContain("no-store");
    const { endpoint, secret } = await made.json();
    expect(secret).toBeTruthy();
    const listed = JSON.stringify(await (await listRoute(as(proToken, "GET", "/api/me/webhooks"))).json());
    expect(listed).toContain(endpoint.id);
    expect(listed).not.toContain(secret);
    // at rest the secret is sealed
    const [stored] = await query<Record<string, string>>("SELECT * FROM webhook_endpoints WHERE id = $1", [
      endpoint.id,
    ]);
    expect(JSON.stringify(stored)).not.toContain(secret);
    (globalThis as { __hook?: unknown }).__hook = { endpoint, secret };
  });

  it("a closed batch queues one delivery per event; the tick sends it signed, with the headers, and only once", async () => {
    const { endpoint, secret } = (globalThis as { __hook?: { endpoint: { id: string }; secret: string } }).__hook!;
    const closed = await closeBatch("sent");
    expect(closed.finishedAt).not.toBeNull();
    await advanceBatch(pro, closed.id, { settings: await settingsFor(pro.id), now: new Date(), environment: "dev" });

    const seen: { url: string; body: string; headers: Record<string, string> }[] = [];
    const send: Send = async (request) => {
      seen.push(request);
      return { status: 204 };
    };
    const first = await deliverWebhooks(SERVER_SECRET, new Date(), { timeoutMs: 1000, send });
    expect(first?.delivered).toBeGreaterThanOrEqual(2);
    const mine = seen.filter(
      (r) =>
        JSON.parse(r.body).payload?.id === closed.id ||
        JSON.parse(r.body).id === closed.id ||
        r.body.includes(closed.id),
    );
    expect(mine.map((r) => r.headers[EVENT_TYPE_HEADER]).sort()).toEqual(["batch.finished", "check.finished"]);
    for (const request of mine) {
      expect(request.url).toBe("https://hooks.example.test/verikora");
      expect(
        verifySignature(secret, request.body, request.headers[SIGNATURE_HEADER], Math.floor(Date.now() / 1000)),
      ).toEqual({ ok: true });
      expect(request.headers[EVENT_ID_HEADER]).toMatch(/^(batch|check):/);
      expect(request.body).not.toMatch(/quote|findings|documentId/);
    }
    const batchEvent = JSON.parse(mine.find((r) => r.headers[EVENT_TYPE_HEADER] === "batch.finished")!.body);
    expect(JSON.stringify(batchEvent)).toContain(`REF-sent`);

    // nothing more is due; and the log says what happened
    const sentBefore = seen.length;
    await deliverWebhooks(SERVER_SECRET, new Date(), { timeoutMs: 1000, send });
    expect(seen).toHaveLength(sentBefore);
    const log = await (
      await deliveriesRoute(as(proToken, "GET", `/api/me/webhooks/${endpoint.id}/deliveries`), params(endpoint.id))
    ).json();
    expect(
      log.deliveries
        .filter((d: { eventId: string }) => d.eventId.endsWith(closed.id))
        .map((d: { status: string }) => d.status),
    ).toEqual(["delivered", "delivered"]);
  });

  it("an endpoint that answers 500 is tried again after the wait, not lost", async () => {
    const closed = await closeBatch("flaky");
    const failing: Send = async () => ({ status: 500 });
    const first = await deliverWebhooks(SERVER_SECRET, new Date(), { timeoutMs: 1000, send: failing });
    expect(first?.retried).toBeGreaterThanOrEqual(1);
    const later = new Date(Date.now() + 60_000);
    let delivered = 0;
    const ok: Send = async (request) => {
      if (request.body.includes(closed.id)) delivered++;
      return { status: 200 };
    };
    await deliverWebhooks(SERVER_SECRET, later, { timeoutMs: 1000, send: ok });
    expect(delivered).toBe(2);
  });

  it("another account never sees or touches the endpoint; rotation gives a new secret; switching off or removing stops the sends", async () => {
    const { endpoint } = (globalThis as { __hook?: { endpoint: { id: string } } }).__hook!;
    expect(
      (await removeRoute(as(freeToken, "DELETE", `/api/me/webhooks/${endpoint.id}`), params(endpoint.id))).status,
    ).toBe(403);
    // a Pro stranger would get a 404, not the endpoint
    const other = await account("pro2", true);
    expect(
      (
        await patchRoute(
          as(other.token, "PATCH", `/api/me/webhooks/${endpoint.id}`, { active: false }),
          params(endpoint.id),
        )
      ).status,
    ).toBe(404);
    expect((await (await listRoute(as(other.token, "GET", "/api/me/webhooks"))).json()).endpoints).toEqual([]);
    await query("DELETE FROM accounts WHERE id = $1", [other.id]);

    const rotated = await rotateRoute(
      as(proToken, "POST", `/api/me/webhooks/${endpoint.id}/rotate`),
      params(endpoint.id),
    );
    expect(rotated.status).toBe(201);
    expect((await rotated.json()).secret).toBeTruthy();

    expect(
      (
        await patchRoute(
          as(proToken, "PATCH", `/api/me/webhooks/${endpoint.id}`, { active: false }),
          params(endpoint.id),
        )
      ).status,
    ).toBe(200);
    const closed = await closeBatch("off");
    const seen: string[] = [];
    await deliverWebhooks(SERVER_SECRET, new Date(Date.now() + 3_600_000), {
      timeoutMs: 1000,
      send: async (r) => (seen.push(r.body), { status: 200 }),
    });
    expect(seen.some((b) => b.includes(closed.id))).toBe(false);
    expect(
      (await removeRoute(as(proToken, "DELETE", `/api/me/webhooks/${endpoint.id}`), params(endpoint.id))).status,
    ).toBe(200);
  });

  it("the administrator's switch turns it all off: nothing is queued", async () => {
    const made = await createRoute(
      as(proToken, "POST", "/api/me/webhooks", {
        url: "https://hooks.example.test/second",
        events: ["batch.finished"],
      }),
    );
    expect(made.status).toBe(201);
    await appSettings().set(actor, GLOBAL, "features.webhooks", false, new Date());
    resetAppSettings();
    const refused = await listRoute(as(proToken, "GET", "/api/me/webhooks"));
    expect([refused.status, (await refused.json()).code]).toEqual([403, "FEATURE_OFF"]);
    const closed = await closeBatch("muted");
    const seen: string[] = [];
    await appSettings().reset(actor, GLOBAL, "features.webhooks", new Date());
    resetAppSettings();
    await deliverWebhooks(SERVER_SECRET, new Date(Date.now() + 7_200_000), {
      timeoutMs: 1000,
      send: async (r) => (seen.push(r.body), { status: 200 }),
    });
    expect(seen.some((b) => b.includes(closed.id))).toBe(false);
  });
});
