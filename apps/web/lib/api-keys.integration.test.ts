import { createHash, randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as rotateRoute } from "@/app/api/me/api-keys/[id]/rotate/route";
import { DELETE as revokeRoute } from "@/app/api/me/api-keys/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/me/api-keys/route";
import { systemClock } from "@/app/system-clock";

import { requireApiKey } from "./api-access";
import { migrate, pool, query } from "./db";
import { resetRateLimits } from "./limits";
import { createSession, SESSION_COOKIE } from "./session";
import { appSettings, resetAppSettings } from "./settings/instance";
import { GLOBAL } from "./settings/service";

/** API keys through the real routes, the plan, the switch, the audit trail and PostgreSQL (CI's service; locally DATABASE_IT=1 DATABASE_URL=…). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;

const as = (token: string, method: string, path: string, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const withKey = (key: string | null) =>
  new Request("http://localhost/api/v1/checks", { headers: key ? { authorization: `Bearer ${key}` } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { status?: number }).status ?? 500;
  }
};

/** The secret part of `yzk_<public id>_<secret>`: the secret is base64url, so it may itself contain « _ » — never split on it. */
const secretOf = (key: string) => key.slice(key.indexOf("_", key.indexOf("_") + 1) + 1);

describe.runIf(enabled)("api keys", () => {
  const stamp = Date.now();
  let owner = "";
  let token = "";
  beforeAll(async () => {
    await migrate();
    [{ id: owner }] = (await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') RETURNING id",
      [`keys-${stamp}@verikora.test`],
    )) as [{ id: string }];
    token = (await createSession(owner, { ip: "203.0.113.9", userAgent: "vitest" })).token;
  });
  afterAll(async () => {
    await appSettings().reset({ id: null, label: "test" }, GLOBAL, "features.apiKeys", new Date());
    await query("DELETE FROM accounts WHERE id = $1", [owner]);
    await pool().end();
  });
  const proUntilNextMonth = () =>
    query(
      "UPDATE accounts SET plan = 'PRO', subscription_status = 'active', current_period_end = now() + interval '30 days' WHERE id = $1",
      [owner],
    );

  it("the free plan has no API: creating a key is refused with the plan's code", async () => {
    resetRateLimits();
    const res = await createRoute(
      as(token, "POST", "/api/me/api-keys", { name: "ERP", scopes: ["checks:write"], expiresInDays: 30 }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "API_PLAN" });
    expect((await (await listRoute(as(token, "GET", "/api/me/api-keys"))).json()).maxActive).toBe(0);
  });

  it("on Pro: a key is created and shown once; the list never shows the key or a hash", async () => {
    resetRateLimits();
    await proUntilNextMonth();
    const res = await createRoute(
      as(token, "POST", "/api/me/api-keys", {
        name: "Mon ERP",
        scopes: ["checks:write", "reports:read"],
        expiresInDays: 90,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { key, apiKey } = await res.json();
    expect(key).toMatch(/^yzk_[0-9a-f]{12}_/);
    expect(apiKey).toMatchObject({
      name: "Mon ERP",
      status: "active",
      scopes: ["checks:write", "reports:read"],
      hint: key.slice(0, 16),
    });
    const list = JSON.stringify(await (await listRoute(as(token, "GET", "/api/me/api-keys"))).json());
    expect(list).not.toContain(secretOf(key));
    expect(list).not.toMatch(/secret|hash/i);
    // the audit trail says who did what, never the key
    const rows = JSON.stringify(
      await query("SELECT action, target_id, detail FROM audit_log WHERE actor_id = $1 AND action LIKE 'apikey.%'", [
        owner,
      ]),
    );
    expect(rows).toContain("apikey.created");
    expect(rows).not.toContain(secretOf(key));
    (globalThis as { __key?: string }).__key = key;
  });

  it("a request with the key is accepted for its scopes only; a missing, wrong or foreign key is refused with a stable code", async () => {
    resetRateLimits();
    const key = (globalThis as { __key?: string }).__key!;
    expect(await requireApiKey(withKey(key), "checks:write", systemClock)).toMatchObject({ ownerId: owner });
    expect(await status(requireApiKey(withKey(null), "checks:write", systemClock))).toBe(401);
    expect(await status(requireApiKey(withKey(`${key.slice(0, -4)}AAAA`), "checks:write", systemClock))).toBe(401);
    // a key that has only one scope cannot do the other
    const narrow = await (
      await createRoute(
        as(token, "POST", "/api/me/api-keys", { name: "Lecture", scopes: ["reports:read"], expiresInDays: 30 }),
      )
    ).json();
    expect(await status(requireApiKey(withKey(narrow.key), "checks:write", systemClock))).toBe(403);
    expect(await requireApiKey(withKey(narrow.key), "reports:read", systemClock)).toMatchObject({ ownerId: owner });
  });

  it("a key issued before the package (a row of migration 0021, its secret hashed with SHA-256) still authenticates, and the package rotates and revokes it (verikora#202)", async () => {
    resetRateLimits();
    // what the product's own code wrote: `yzk_<12 hex>_<base64url secret>`, only the SHA-256 of the secret kept; written here by hand, not by the package
    const publicId = randomBytes(6).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const legacy = `yzk_${publicId}_${secret}`;
    const [row] = await query<{ id: string }>(
      "INSERT INTO api_keys (id, owner_id, name, public_id, secret_hash, scopes, expires_at, created_at) VALUES (gen_random_uuid(), $1, 'Clé historique', $2, $3, ARRAY['checks:write'], now() + interval '90 days', now() - interval '60 days') RETURNING id",
      [owner, publicId, createHash("sha256").update(secret).digest("hex")],
    );
    expect(await requireApiKey(withKey(legacy), "checks:write", systemClock)).toMatchObject({ ownerId: owner });
    expect(
      await status(
        requireApiKey(withKey(`yzk_${publicId}_${randomBytes(32).toString("base64url")}`), "checks:write", systemClock),
      ),
    ).toBe(401);
    const rotated = await (
      await rotateRoute(as(token, "POST", `/api/me/api-keys/${row!.id}/rotate`), params(row!.id))
    ).json();
    expect(await requireApiKey(withKey(legacy), "checks:write", systemClock)).toMatchObject({ ownerId: owner });
    expect(await requireApiKey(withKey(rotated.key), "checks:write", systemClock)).toMatchObject({ ownerId: owner });
    expect(
      (await revokeRoute(as(token, "DELETE", `/api/me/api-keys/${row!.id}`), params(row!.id))).status,
    ).toBeLessThan(300);
    expect(await status(requireApiKey(withKey(legacy), "checks:write", systemClock))).toBe(401);
  });

  it("is rate-limited per key by the plan's setting", async () => {
    resetRateLimits();
    const key = (
      await (
        await createRoute(
          as(token, "POST", "/api/me/api-keys", { name: "Limité", scopes: ["reports:read"], expiresInDays: 30 }),
        )
      ).json()
    ).key;
    await appSettings().set({ id: null, label: "test" }, GLOBAL, "limits.apiRequestsPerMinute", 3, new Date());
    try {
      for (let i = 0; i < 3; i++) await requireApiKey(withKey(key), "reports:read", systemClock);
      expect(await status(requireApiKey(withKey(key), "reports:read", systemClock))).toBe(429);
    } finally {
      await appSettings().reset({ id: null, label: "test" }, GLOBAL, "limits.apiRequestsPerMinute", new Date());
      resetRateLimits();
    }
  });

  it("rotation gives a new key and the old one keeps working during its grace period; revocation is immediate", async () => {
    resetRateLimits();
    const created = await (
      await createRoute(
        as(token, "POST", "/api/me/api-keys", { name: "À tourner", scopes: ["reports:read"], expiresInDays: 30 }),
      )
    ).json();
    const rotated = await rotateRoute(
      as(token, "POST", `/api/me/api-keys/${created.apiKey.id}/rotate`),
      params(created.apiKey.id),
    );
    expect(rotated.status).toBe(201);
    const next = await rotated.json();
    expect(next.apiKey.name).toBe("À tourner");
    expect(await requireApiKey(withKey(created.key), "reports:read", systemClock)).toBeTruthy();
    expect(await requireApiKey(withKey(next.key), "reports:read", systemClock)).toBeTruthy();
    expect(
      (await revokeRoute(as(token, "DELETE", `/api/me/api-keys/${next.apiKey.id}`), params(next.apiKey.id))).status,
    ).toBe(200);
    expect(await status(requireApiKey(withKey(next.key), "reports:read", systemClock))).toBe(401);
    expect(await status(requireApiKey(withKey(created.key), "reports:read", systemClock))).toBe(200);
    // a stranger cannot touch it
    const [{ id: stranger }] = (await query<{ id: string }>(
      "INSERT INTO accounts (email, password_hash) VALUES ($1, 'x') RETURNING id",
      [`keys-stranger-${stamp}@verikora.test`],
    )) as [{ id: string }];
    const strangerToken = (await createSession(stranger, { ip: "203.0.113.10", userAgent: "vitest" })).token;
    expect(
      (
        await revokeRoute(
          as(strangerToken, "DELETE", `/api/me/api-keys/${created.apiKey.id}`),
          params(created.apiKey.id),
        )
      ).status,
    ).toBe(404);
    await query("DELETE FROM accounts WHERE id = $1", [stranger]);
  });

  it("the administrator's global switch turns every key off at once", async () => {
    resetRateLimits();
    const key = (
      await (
        await createRoute(
          as(token, "POST", "/api/me/api-keys", { name: "Coupure", scopes: ["reports:read"], expiresInDays: 30 }),
        )
      ).json()
    ).key;
    await appSettings().set({ id: null, label: "test" }, GLOBAL, "features.apiKeys", false, new Date());
    resetAppSettings();
    try {
      expect(await status(requireApiKey(withKey(key), "reports:read", systemClock))).toBe(403);
      expect(
        (
          await createRoute(
            as(token, "POST", "/api/me/api-keys", { name: "x", scopes: ["reports:read"], expiresInDays: 30 }),
          )
        ).status,
      ).toBe(403);
    } finally {
      await appSettings().reset({ id: null, label: "test" }, GLOBAL, "features.apiKeys", new Date());
      resetAppSettings();
    }
    expect(await requireApiKey(withKey(key), "reports:read", systemClock)).toBeTruthy();
  });
});
