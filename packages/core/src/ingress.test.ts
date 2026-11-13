import { describe, expect, it } from "vitest";

import { restoreRefusal } from "./ingress";

const ingress = (headers: Record<string, string>) =>
  new Response("<html><body>504 Gateway Time-out</body></html>", {
    status: 504,
    headers: { "content-type": "text/html", ...headers },
  });

describe("restoreRefusal (the ingress turned a 502 into a 504 page)", () => {
  it("gives back the JSON refusal from X-Error-Code, with the original status", async () => {
    const res = restoreRefusal(ingress({ "x-error-code": "SOVKORA_UNAVAILABLE", "x-do-orig-status": "502" }));
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.json()).toMatchObject({ code: "SOVKORA_UNAVAILABLE" });
  });
  it("carries Retry-After into the body so the retry hint survives", async () => {
    const res = restoreRefusal(ingress({ "x-error-code": "SOVKORA_BUSY", "retry-after": "15" }));
    expect(res.headers.get("retry-after")).toBe("15");
    expect(await res.json()).toMatchObject({ code: "SOVKORA_BUSY", retryAfterSeconds: 15 });
  });
  it("keeps the status when the ingress left no original", () => {
    expect(restoreRefusal(ingress({ "x-error-code": "SOVKORA_KEY" })).status).toBe(504);
  });
  it("leaves a JSON answer, a success and an answer with no code untouched", async () => {
    const json = Response.json({ code: "PAYWALL" }, { status: 402, headers: { "x-error-code": "PAYWALL" } });
    expect(restoreRefusal(json)).toBe(json);
    const ok = new Response("<html>", { status: 200, headers: { "x-error-code": "X" } });
    expect(restoreRefusal(ok)).toBe(ok);
    const bare = ingress({});
    expect(restoreRefusal(bare)).toBe(bare);
  });
  it("ignores a header that is not a code", () => {
    const odd = ingress({ "x-error-code": "<script>" });
    expect(restoreRefusal(odd)).toBe(odd);
  });
});
