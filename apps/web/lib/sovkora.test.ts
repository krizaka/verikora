import { describe, expect, it } from "vitest";

import { createSovkoraClient, sovkoraRefusal } from "./sovkora";

const RUN = {
  id: "8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c",
  studioKey: "compliance-check",
  blueprintVersion: "1.1.1",
  status: "RUNNING",
  outputs: [],
  steps: [],
};

function fakeEdge(routes: Record<string, (init: RequestInit) => { status: number; body?: unknown }>) {
  const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push({
      method,
      url: path,
      auth: new Headers(init.headers).get("authorization"),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${method} ${path}`];
    const { status, body } = route ? route(init) : { status: 404 };
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("the Sovkora client", () => {
  it("installs the Studio once, then starts the run with the service key", async () => {
    const edge = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [] }),
      "POST /edge/api/v1/studios/compliance-check/installations": () => ({
        status: 201,
        body: { studioKey: "compliance-check" },
      }),
      "POST /edge/api/v1/studios/compliance-check/runs": () => ({ status: 202, body: RUN }),
    });
    const client = createSovkoraClient({
      baseUrl: "https://dev.sovkora.com/edge",
      apiKey: "oz_test",
      fetch: edge.fetch,
    });
    const run = await client.startRun("compliance-check", {
      document: "Bail…",
      jurisdiction: "FR",
      asOf: "2026-10-14",
    });
    expect(run.id).toBe(RUN.id);
    await client.startRun("compliance-check", { document: "Bail…", jurisdiction: "FR" });
    expect(edge.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /edge/api/v1/studios/installations",
      "POST /edge/api/v1/studios/compliance-check/installations",
      "POST /edge/api/v1/studios/compliance-check/runs",
      "POST /edge/api/v1/studios/compliance-check/runs",
    ]);
    expect(edge.calls.every((c) => c.auth === "Bearer oz_test")).toBe(true);
    expect(edge.calls[2]?.body).toEqual({ inputs: { document: "Bail…", jurisdiction: "FR", asOf: "2026-10-14" } });
  });

  it("does not install a Studio already installed", async () => {
    const edge = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [{ studioKey: "document-authenticity" }] }),
      "POST /edge/api/v1/studios/document-authenticity/runs": () => ({
        status: 202,
        body: { ...RUN, studioKey: "document-authenticity" },
      }),
    });
    const client = createSovkoraClient({
      baseUrl: "https://dev.sovkora.com/edge/",
      apiKey: "oz_test",
      fetch: edge.fetch,
    });
    await client.startRun("document-authenticity", { documentBase64: "JVBERi0=" });
    expect(edge.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("turns Sovkora's refusals into stable codes, and never starts without a key", async () => {
    expect(sovkoraRefusal(401).code).toBe("SOVKORA_KEY");
    expect(sovkoraRefusal(409).code).toBe("SOVKORA_LOCKED");
    expect(sovkoraRefusal(500).code).toBe("SOVKORA_UNAVAILABLE");
    const locked = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [{ studioKey: "compliance-check" }] }),
      "POST /edge/api/v1/studios/compliance-check/runs": () => ({ status: 409 }),
    });
    await expect(
      createSovkoraClient({ baseUrl: "https://x/edge", apiKey: "oz_t", fetch: locked.fetch }).startRun(
        "compliance-check",
        {},
      ),
    ).rejects.toMatchObject({ body: { code: "SOVKORA_LOCKED" } });
    await expect(
      createSovkoraClient({ baseUrl: "https://x/edge", apiKey: undefined, fetch: locked.fetch }).getRun(RUN.id),
    ).rejects.toMatchObject({ body: { code: "SOVKORA_NOT_CONFIGURED" } });
  });

  it("does not start a kind that the pinned 1.x Studio would judge as a lease (declaredKind is read by 2.x only)", async () => {
    const old = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({
        status: 200,
        body: [{ studioKey: "compliance-check", pinnedVersion: "1.4.0" }],
      }),
    });
    const client = createSovkoraClient({ baseUrl: "https://x/edge", apiKey: "oz_t", fetch: old.fetch });
    await expect(
      client.startRun("compliance-check", { document: "Avis", declaredKind: "NOTICE" }),
    ).rejects.toMatchObject({ body: { code: "SOVKORA_STUDIO_OLD" } });
    expect(old.calls.some((c) => c.url.includes("/runs"))).toBe(false);
  });
  it("a busy engine (429, « too many concurrent runs ») is SOVKORA_BUSY with the wait it asked for — not a failure (verikora#248)", async () => {
    expect(sovkoraRefusal(429)).toEqual({ status: 429, code: "SOVKORA_BUSY" });
    const busy = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [{ studioKey: "compliance-check" }] }),
      "POST /edge/api/v1/studios/compliance-check/runs": () => ({
        status: 429,
        body: { status: "too_many_concurrent_runs", limit: 2, active: 2, retryAfterSeconds: 15 },
      }),
    });
    const error = await createSovkoraClient({ baseUrl: "https://x/edge", apiKey: "oz_t", fetch: busy.fetch })
      .startRun("compliance-check", {})
      .catch((e: unknown) => e as { status: number; body: Record<string, unknown>; headers: Record<string, string> });
    expect(error).toMatchObject({
      status: 429,
      body: { code: "SOVKORA_BUSY", retryAfter: 15 },
      headers: { "Retry-After": "15" },
    });
  });

  it("refuses a run id that is not one before calling anyone", async () => {
    const edge = fakeEdge({});
    expect(() =>
      createSovkoraClient({ baseUrl: "https://x/edge", apiKey: "oz_t", fetch: edge.fetch }).getRun("../admin"),
    ).toThrow();
    expect(edge.calls).toHaveLength(0);
  });

  it("refuses an answer of the wrong shape rather than guessing", async () => {
    const edge = fakeEdge({
      "GET /edge/api/v1/studios/runs/8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c": () => ({ status: 200, body: { nope: 1 } }),
    });
    await expect(
      createSovkoraClient({ baseUrl: "https://x/edge", apiKey: "oz_t", fetch: edge.fetch }).getRun(RUN.id),
    ).rejects.toMatchObject({ body: { code: "SOVKORA_SHAPE" } });
  });

  // krizaka-internal#3214: a run start that never answered left the request to the ingress (a bare 504). One deadline is shared by
  // every call of the start, below the ingress's, and each call says in the server log what it got and how long it took.
  it("answers SOVKORA_UNAVAILABLE when the edge never answers, within the start's one deadline", async () => {
    const neverAnswers = (() => new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    const lines: string[] = [];
    const client = createSovkoraClient({
      baseUrl: "https://x/edge",
      apiKey: "oz_t",
      fetch: neverAnswers,
      timeoutMs: 60_000,
      startDeadlineMs: 50,
      log: (line) => lines.push(line),
    });
    const started = performance.now();
    await expect(client.startRun("compliance-check", {})).rejects.toMatchObject({
      status: 502,
      body: { code: "SOVKORA_UNAVAILABLE" },
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(lines).toEqual([
      expect.stringMatching(/^sovkora: GET \/api\/v1\/studios\/installations no answer in \d+ ms$/),
    ]);
  });

  it("shares the deadline across the installation and the run (no 20 s per call that add up)", async () => {
    const edge = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [{ studioKey: "compliance-check" }] }),
    });
    const fetch = (async (url: string, init: RequestInit = {}) =>
      (init.method ?? "GET") === "GET"
        ? new Promise<Response>((resolve) => setTimeout(() => resolve(edge.fetch(url, init)), 30))
        : new Promise<Response>(() => {})) as unknown as typeof globalThis.fetch;
    const client = createSovkoraClient({
      baseUrl: "https://x/edge",
      apiKey: "oz_t",
      fetch,
      timeoutMs: 60_000,
      startDeadlineMs: 80,
      log: () => {},
    });
    const started = performance.now();
    await expect(client.startRun("compliance-check", {})).rejects.toMatchObject({
      body: { code: "SOVKORA_UNAVAILABLE" },
    });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("logs each call's method, path, status, code and elapsed time, never the key or the query", async () => {
    const edge = fakeEdge({
      "GET /edge/api/v1/studios/installations": () => ({ status: 200, body: [] }),
      "POST /edge/api/v1/studios/compliance-check/installations": () => ({ status: 401 }),
    });
    const lines: string[] = [];
    const client = createSovkoraClient({
      baseUrl: "https://x/edge",
      apiKey: "oz_secret_key",
      fetch: edge.fetch,
      log: (line) => lines.push(line),
    });
    await expect(client.startRun("compliance-check", {})).rejects.toMatchObject({ body: { code: "SOVKORA_KEY" } });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^sovkora: GET \/api\/v1\/studios\/installations 200 in \d+ ms$/);
    expect(lines[1]).toMatch(
      /^sovkora: POST \/api\/v1\/studios\/compliance-check\/installations 401 SOVKORA_KEY in \d+ ms$/,
    );
    expect(lines.join("\n")).not.toMatch(/oz_secret_key|locale=/);
  });
});
