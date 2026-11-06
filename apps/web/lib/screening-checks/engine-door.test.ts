import { createOrazakaClient } from "@krizaka/orazaka-client";
import { describe, expect, it } from "vitest";

import { engineDoor } from "./engine-door";
import type { CheckCall, CheckPurpose } from "./model";

/*
 * Contract of the engine's door as Verikora uses it (sovkora-engine#105): the real shared client speaks to a fake Sovkora
 * (a `fetch` that answers the door's JSON), and the adapter reads the answers 1:1 into the screening's vocabulary.
 */
const NOW = { now: () => new Date("2026-10-27T12:00:00Z") };
const CALL: CheckCall = {
  userId: "landlord-1",
  runId: "run-1",
  subject: { subjectId: "scr-1", firstName: "Ariane", lastName: "Tremblay" },
  region: "QC",
};

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** A fake Sovkora: answers each door call with the next scripted answer, and remembers what it was asked. */
function fakeSovkora(answers: Array<{ status?: number; body: unknown } | "down">) {
  const seen: Seen[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    seen.push({
      method: init.method ?? "GET",
      path: u.pathname + u.search,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    const next = answers.shift();
    if (!next || next === "down") throw new TypeError("connection refused");
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}

const reply = (outcome: string, extra: Record<string, unknown> = {}) => ({
  body: {
    purpose: "COURT_RECORDS",
    outcome,
    refusal: null,
    category: "NONE",
    providerRef: null,
    runId: "run-1",
    ...extra,
  },
});

function door(
  answers: Parameters<typeof fakeSovkora>[0],
  consented: (purpose: CheckPurpose) => boolean = () => true,
  apiKey: string | null = "oz_test",
) {
  const sovkora = fakeSovkora(answers);
  const asked: CheckPurpose[] = [];
  const client = createOrazakaClient({
    baseUrl: "https://sovkora.test",
    apiKey: apiKey ?? undefined,
    clock: NOW,
    fetch: sovkora.fetch,
    circuit: false,
  });
  return {
    sovkora,
    asked,
    door: engineDoor(client, async (_id, purpose) => (asked.push(purpose), consented(purpose))),
  };
}

describe("the engine's door, from Verikora (sovkora-engine#105)", () => {
  it("MATCH: the closed outcome and category come through, and the consent is read before the call", async () => {
    const t = door([reply("MATCH", { category: "TAL_NON_PAYMENT" })]);
    const out = await t.door.submit("COURT_RECORDS", CALL);
    expect(out).toEqual({ outcome: "MATCH", refusal: null, category: "TAL_NON_PAYMENT", providerRef: null });
    expect(t.asked).toEqual(["COURT_RECORDS"]);
    expect(t.sovkora.seen).toEqual([
      {
        method: "POST",
        path: "/api/v1/checks/court-records",
        body: expect.objectContaining({
          subjectId: "scr-1",
          lastName: "Tremblay",
          firstName: "Ariane",
          region: "QC",
          runId: "run-1",
          consented: true,
        }),
      },
    ]);
  });

  it("NO_MATCH on the credit purpose goes to the credit path", async () => {
    const t = door([reply("NO_MATCH", { purpose: "CREDIT" })]);
    expect(await t.door.submit("CREDIT", CALL)).toMatchObject({ outcome: "NO_MATCH", refusal: null });
    expect(t.sovkora.seen[0]?.path).toBe("/api/v1/checks/credit");
  });

  it("PENDING keeps the provider's reference, and the collect carries the subject and the consent that still stands", async () => {
    const t = door([
      reply("PENDING", { providerRef: "case-777" }),
      reply("MATCH", { category: "CRIMINAL", providerRef: "case-777" }),
    ]);
    const started = await t.door.submit("COURT_RECORDS", CALL);
    expect(started).toMatchObject({ outcome: "PENDING", providerRef: "case-777" });
    const collected = await t.door.collect("COURT_RECORDS", CALL, started.providerRef!);
    expect(collected).toMatchObject({ outcome: "MATCH", category: "CRIMINAL" });
    expect(t.sovkora.seen[1]).toEqual({
      method: "GET",
      path: "/api/v1/checks/case-777?subjectId=scr-1&consented=true",
      body: null,
    });
  });

  it("a consent withdrawn since is told to Sovkora at the poll, which refuses: REFUSED / NO_CONSENT", async () => {
    const t = door([reply("REFUSED", { refusal: "NO_CONSENT" })], () => false);
    const out = await t.door.collect("COURT_RECORDS", CALL, "case-777");
    expect(out).toMatchObject({ outcome: "REFUSED", refusal: "NO_CONSENT" });
    expect(t.sovkora.seen[0]?.path).toContain("consented=false");
  });

  it("no consent at submit: Sovkora's REFUSED / NO_CONSENT is the result, not an error", async () => {
    const t = door([reply("REFUSED", { refusal: "NO_CONSENT" })], () => false);
    expect(await t.door.submit("COURT_RECORDS", CALL)).toMatchObject({ outcome: "REFUSED", refusal: "NO_CONSENT" });
    expect(t.sovkora.seen[0]?.body).toMatchObject({ consented: false });
  });

  it("an engine with no provider says REFUSED / NOT_CONFIGURED; so does a product with no key", async () => {
    const engine = door([reply("REFUSED", { refusal: "NOT_CONFIGURED" })]);
    expect(await engine.door.submit("COURT_RECORDS", CALL)).toMatchObject({
      outcome: "REFUSED",
      refusal: "NOT_CONFIGURED",
    });
    const keyless = door([], () => true, null);
    expect(await keyless.door.submit("COURT_RECORDS", CALL)).toMatchObject({
      outcome: "REFUSED",
      refusal: "NOT_CONFIGURED",
    });
    expect(keyless.sovkora.seen).toEqual([]);
  });

  it("a failure of the door is PROVIDER_ERROR at submit and stays PENDING at collect, never an invented result", async () => {
    expect(await door(["down"]).door.submit("COURT_RECORDS", CALL)).toEqual({
      outcome: "PROVIDER_ERROR",
      refusal: null,
      category: "NONE",
      providerRef: null,
    });
    expect(await door([{ status: 429, body: {} }]).door.submit("CREDIT", CALL)).toMatchObject({
      outcome: "PROVIDER_ERROR",
    });
    expect(await door([{ status: 503, body: {} }]).door.collect("COURT_RECORDS", CALL, "case-777")).toEqual({
      outcome: "PENDING",
      refusal: null,
      category: "NONE",
      providerRef: "case-777",
    });
  });

  it("an answer that is not a check is a provider error, not a result", async () => {
    expect(await door([{ body: { outcome: "MAYBE" } }]).door.submit("COURT_RECORDS", CALL)).toMatchObject({
      outcome: "PROVIDER_ERROR",
    });
  });
});
