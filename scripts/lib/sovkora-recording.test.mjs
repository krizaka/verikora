import { afterEach, expect, test, vi } from "vitest";

import { runToEnd, sovkoraCall, sovkoraClient, sovkoraRoot } from "./sovkora-recording.mjs";

afterEach(() => vi.unstubAllGlobals());

const answer = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test("the root is https on sovkora.com, trailing slash dropped; anything else is refused", () => {
  expect(sovkoraRoot("https://dev.sovkora.com/edge/")).toBe("https://dev.sovkora.com/edge");
  expect(() => sovkoraRoot("http://dev.sovkora.com/edge")).toThrow(/only talks to Sovkora/);
  expect(() => sovkoraRoot("https://sovkora.com.evil.test/edge")).toThrow(/only talks to Sovkora/);
});

test("the client needs the key and defaults to the dev engine", () => {
  expect(() => sovkoraClient({})).toThrow("AI_API_KEY is not set");
  expect(sovkoraClient({ AI_API_KEY: "k" })).toMatchObject({
    base: "https://dev.sovkora.com/edge",
    studio: "compliance-check",
  });
});

test("a call sends the bearer key and the JSON body to a Studio path; another path is refused before any request", async () => {
  const fetchMock = vi.fn(async () => answer({ ok: 1 }));
  vi.stubGlobal("fetch", fetchMock);
  const call = sovkoraCall("https://dev.sovkora.com/edge", "k");
  await expect(call("/api/v1/studios/compliance-check/runs", { method: "POST", body: { a: 1 } })).resolves.toEqual({
    ok: 1,
  });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://dev.sovkora.com/edge/api/v1/studios/compliance-check/runs");
  expect(init).toMatchObject({ method: "POST", body: '{"a":1}' });
  expect(init.headers).toMatchObject({ authorization: "Bearer k", "content-type": "application/json" });
  await expect(call("/api/v1/studios/../admin")).rejects.toThrow("not a Studio path");
  await expect(call("//evil.test/x")).rejects.toThrow("not a Studio path");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a refusal names the status and the path without its query", async () => {
  vi.stubGlobal("fetch", async () => answer({}, false, 403));
  await expect(sovkoraCall("https://dev.sovkora.com/edge", "k")("/api/v1/studios/installations?x=1")).rejects.toThrow(
    "Sovkora answered 403 on GET /api/v1/studios/installations",
  );
});

test("a run is polled to its end; a run that does not succeed, or an odd run id, is an error", async () => {
  vi.useFakeTimers();
  try {
    const calls = [answer({ id: "r1", status: "RUNNING" }), answer({ id: "r1", status: "SUCCEEDED", outputs: 1 })];
    vi.stubGlobal("fetch", async () => calls.shift());
    const client = sovkoraClient({ AI_API_KEY: "k" });
    const done = runToEnd(client, { document: "x" }, "case");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(done).resolves.toMatchObject({ id: "r1", status: "SUCCEEDED" });

    vi.stubGlobal("fetch", async () => answer({ id: "r2", status: "FAILED" }));
    await expect(runToEnd(client, {}, "case")).rejects.toThrow("case: the run r2 ended FAILED");

    vi.stubGlobal("fetch", async () => answer({ id: "../x", status: "RUNNING" }));
    const odd = expect(runToEnd(client, {}, "case")).rejects.toThrow("unusable run id");
    await vi.advanceTimersByTimeAsync(2000);
    await odd;
  } finally {
    vi.useRealTimers();
  }
});
