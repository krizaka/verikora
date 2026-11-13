import { describe, expect, it } from "vitest";

import { isPhotoFile, refusalCode, refusedBy, translated } from "./upload";

describe("the upload path", () => {
  it("keeps the refusal's code on the translated error, so a network failure is still retried", () => {
    const error = translated(Object.assign(new Error("NETWORK"), { body: { code: "NETWORK" } }), (key) => `[${key}]`);
    expect(error.message).toBe("[errors.NETWORK]");
    expect(refusalCode(error)).toBe("NETWORK");
    expect(refusalCode(translated(new TypeError("boom"), (key) => key))).toBe("UNKNOWN");
  });
  it("knows a photo by its type or its name, from a File or a queue item", () => {
    expect(isPhotoFile({ name: "p.jpg", type: "image/jpeg" })).toBe(true);
    expect(isPhotoFile({ name: "p.HEIC" })).toBe(true);
    expect(isPhotoFile({ name: "bail.pdf", type: "application/pdf" })).toBe(false);
  });
});

describe("an upload refused behind the ingress (krizaka-internal#3225)", () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;
  it("reads the code from X-Error-Code when the body is the ingress's page, not JSON", () => {
    const error = refusedBy(504, null, headers({ "x-error-code": "SOVKORA_UNAVAILABLE" }));
    expect(refusalCode(error)).toBe("SOVKORA_UNAVAILABLE");
    expect(refusalCode(translated(error, (key) => key))).toBe("SOVKORA_UNAVAILABLE");
  });
  it("prefers the JSON body's code, and says UNKNOWN when nothing names one", () => {
    expect(refusalCode(refusedBy(402, { code: "PAYWALL" }, headers({ "x-error-code": "OTHER" })))).toBe("PAYWALL");
    expect(refusalCode(refusedBy(504, "<html>", headers({})))).toBe("UNKNOWN");
  });
});
