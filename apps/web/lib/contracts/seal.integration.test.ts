import { beforeAll, describe, expect, it } from "vitest";

import { POST as createKeyRoute } from "@/app/api/me/api-keys/route";
import { GET as fileRoute } from "@/app/api/v1/contracts/[id]/file/route";
import { POST as sealRoute } from "@/app/api/v1/contracts/seal/route";
import { GET as verifyRoute } from "@/app/api/verify/contract/[sha256]/route";

import { migrate, query } from "../db";
import { resetRateLimits } from "../rate-limit";
import { createSession, SESSION_COOKIE } from "../session";

/** The seal of a contract through its routes: a key with the scope, the same request twice, the file, the public check. Against PostgreSQL (CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const contract = {
  partnerId: "orochia",
  documentType: "CREATOR_PARTNERSHIP_CONTRACT_90_10",
  contractPayload: { terms: { split: { creator: 90, platform: 10 } }, note: `contract ${stamp}` },
  parties: [
    { role: "PLATFORM", name: "Plateforme Exemple Inc.", signedAt: "2026-10-17T12:00:00Z" },
    { role: "CREATOR", userId: "c79f-demo", attestationId: "att_demo_1", signedAt: "2026-10-17T12:05:00Z" },
  ],
  complianceRuleset: "PARTNER-FRAMEWORK-1",
};

describe.runIf(enabled)("sealing a contract for a partner (yomizaka#71)", () => {
  let bearer = "";
  let narrow = "";
  let ownerId = "";
  const post = (key: string | null, body: unknown, headers: Record<string, string> = {}) =>
    sealRoute(new Request("http://localhost/api/v1/contracts/seal", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, body: JSON.stringify(body) }));
  const get = (path: string, key?: string) => new Request(`http://localhost${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

  beforeAll(async () => {
    await migrate();
    const [owner] = await query<{ id: string }>("INSERT INTO accounts (email, plan, subscription_status, current_period_end) VALUES ($1, 'PRO', 'active', now() + interval '30 days') RETURNING id", [`seal-${stamp}@yomizaka.test`]);
    ownerId = owner!.id;
    const { token } = await createSession(ownerId, { ip: "203.0.113.31", userAgent: "vitest" });
    const key = async (scopes: string[]) =>
      (await (await createKeyRoute(new Request("http://localhost/api/me/api-keys", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: scopes.join("+"), scopes, expiresInDays: 30 }) }))).json()).key as string;
    bearer = await key(["contracts:seal"]);
    narrow = await key(["reports:read"]);
  });

  it("seals with a key that has the scope: 201, the file's SHA-256, the attestation, an audit line without personal information", async () => {
    resetRateLimits();
    const res = await post(bearer, contract);
    expect(res.status).toBe(201);
    const sealed = await res.json();
    expect(sealed).toMatchObject({ success: true, contractId: expect.stringMatching(/^ctr_[0-9a-f]{24}$/), sha256: expect.stringMatching(/^[0-9a-f]{64}$/), attestation: { signature: expect.any(String), publicKey: expect.any(String) } });
    const [line] = await query<{ detail: Record<string, unknown>; actor_label: string }>("SELECT detail, actor_label FROM audit_log WHERE actor_id = $1 AND action = 'api.contract.sealed'", [ownerId]);
    expect(line!.actor_label).toMatch(/^api-key:/);
    expect(JSON.stringify(line!.detail)).not.toMatch(/Plateforme|c79f|att_demo/);
  });

  it("the same request is the same contract: 200 with the first seal, nothing sealed twice", async () => {
    resetRateLimits();
    const first = await (await post(bearer, { ...contract, contractPayload: { ...contract.contractPayload, once: 1 } })).json();
    const again = await post(bearer, { ...contract, contractPayload: { ...contract.contractPayload, once: 1 } });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ contractId: first.contractId, sha256: first.sha256, attestation: { signature: first.attestation.signature } });
    const [count] = await query<{ n: string }>("SELECT count(*) AS n FROM sealed_contracts WHERE id = $1", [first.contractId]);
    expect(count!.n).toBe("1");
  });

  it("refuses a key without the scope (403), no key (401), a bad body (400, the fields named) and a zone it cannot keep it in (409)", async () => {
    resetRateLimits();
    expect((await post(narrow, contract)).status).toBe(403);
    expect((await post(null, contract)).status).toBe(401);
    const bad = await post(bearer, { ...contract, parties: [] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "BAD_REQUEST", fields: ["parties"] });
    const zone = await post(bearer, contract, { "x-data-residency-zone": "CA-QC" });
    expect(zone.status).toBe(409);
    expect(await zone.json()).toMatchObject({ code: "ZONE_UNAVAILABLE" });
    expect((await post(bearer, contract, { "x-data-residency-zone": "CA-ON" })).status).toBe(200);
  });

  it("gives the sealed file back to the account that sealed it, and to no other", async () => {
    resetRateLimits();
    const sealed = await (await post(bearer, contract)).json();
    const res = await fileRoute(get(`/api/v1/contracts/${sealed.contractId}/file`, bearer), params({ id: sealed.contractId }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const [other] = await query<{ id: string }>("INSERT INTO accounts (email, plan, subscription_status, current_period_end) VALUES ($1, 'PRO', 'active', now() + interval '30 days') RETURNING id", [`seal-other-${stamp}@yomizaka.test`]);
    const { token } = await createSession(other!.id, { ip: "203.0.113.32", userAgent: "vitest" });
    const created = await createKeyRoute(new Request("http://localhost/api/me/api-keys", { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "other", scopes: ["contracts:seal"], expiresInDays: 30 }) }));
    const stranger = (await created.json()).key as string;
    const refused = await fileRoute(get(`/api/v1/contracts/${sealed.contractId}/file`, stranger), params({ id: sealed.contractId }));
    expect(refused.status).toBe(404);
  });

  it("anyone can check a copy by its SHA-256: who sealed it and when — and no name, no account, no content", async () => {
    resetRateLimits();
    const sealed = await (await post(bearer, { ...contract, contractPayload: { ...contract.contractPayload, forTheCheck: 1 } })).json();
    const res = await verifyRoute(get(`/api/verify/contract/${sealed.sha256}`), params({ sha256: sealed.sha256 }));
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(answer).toMatchObject({ valid: true, sha256: sealed.sha256, contractId: sealed.contractId, partnerId: "orochia", documentType: "CREATOR_PARTNERSHIP_CONTRACT_90_10" });
    expect(JSON.stringify(answer)).not.toMatch(/Plateforme|c79f|att_demo|PARTNER-FRAMEWORK|terms/);
    expect((await verifyRoute(get("/api/verify/contract/" + "0".repeat(64)), params({ sha256: "0".repeat(64) }))).status).toBe(404);
    expect((await verifyRoute(get("/api/verify/contract/nope"), params({ sha256: "nope" }))).status).toBe(404);
  });

  it("does not vouch for a stored copy that was altered", async () => {
    resetRateLimits();
    const sealed = await (await post(bearer, { ...contract, contractPayload: { ...contract.contractPayload, altered: 1 } })).json();
    await query("UPDATE sealed_contracts SET content = overlay(content placing 'X' from 600 for 1) WHERE id = $1", [sealed.contractId]);
    const res = await verifyRoute(get(`/api/verify/contract/${sealed.sha256}`), params({ sha256: sealed.sha256 }));
    expect(res.status).toBe(409);
    expect((await res.json()).valid).toBe(false);
  });
});
