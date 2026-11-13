import { afterEach, describe, expect, it, vi } from "vitest";

import { startIfSure } from "@/components/console/start-check";

import { storedDocument } from "./fixtures/stored-document";
import { installIngressAwareFetch } from "./ingress-fetch";

const DOC = storedDocument();

let restore = () => {};
afterEach(() => restore());

/** The run start as the browser lives it behind DigitalOcean: the GET answers, the POST (a 502 upstream) comes back a bare 504 page. */
const behindTheIngress = (code: string, extra: Record<string, string> = {}) => {
  const fake = vi.fn(async (_url: unknown, init?: RequestInit) =>
    (init?.method ?? "GET") === "GET"
      ? Response.json(DOC)
      : new Response("<html>504 Gateway Time-out</html>", {
          status: 504,
          headers: { "content-type": "text/html", "x-do-orig-status": "502", "x-error-code": code, ...extra },
        }),
  );
  restore = installIngressAwareFetch(fake as unknown as typeof fetch);
};

describe("run start behind the DigitalOcean ingress (krizaka-internal#3225)", () => {
  it.each(["SOVKORA_UNAVAILABLE", "SOVKORA_KEY", "SOVKORA_BUSY", "SOVKORA_SHAPE"])(
    "shows the %s refusal although the 502 came back as an HTML 504",
    async (code) => {
      behindTheIngress(code, { "retry-after": "15" });
      const outcome = await startIfSure("d1", "lease", ["QC"], new Date("2026-10-23T12:00:00Z"));
      expect(outcome).toEqual({ started: false, refused: code });
    },
  );
  it("still reads a JSON refusal as before", async () => {
    restore = installIngressAwareFetch((async (_u: unknown, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json(DOC)
        : Response.json({ code: "PAYWALL" }, { status: 402 })) as unknown as typeof fetch);
    expect(await startIfSure("d1", "lease", ["QC"], new Date("2026-10-23T12:00:00Z"))).toEqual({
      started: false,
      refused: "PAYWALL",
    });
  });
});
