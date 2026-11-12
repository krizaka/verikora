import { describe, expect, it } from "vitest";

import { codeOf, fieldText, handle, HttpError, refuse } from "./http";

describe("fieldText", () => {
  const form = new FormData();
  form.set("token", "abc");
  form.set("upload", new File(["x"], "x.txt"));

  it("reads a text field", () => expect(fieldText(form, "token")).toBe("abc"));
  it("is empty for an absent field, a file or no form", () => {
    expect(fieldText(form, "missing")).toBe("");
    expect(fieldText(form, "upload")).toBe("");
    expect(fieldText(null, "token")).toBe("");
  });
});

describe("codeOf", () => {
  it("is the code an HttpError answers with", () =>
    expect(codeOf(refuse(400, "BAD_REQUEST", "no"), "FALLBACK")).toBe("BAD_REQUEST"));
  it("is the fallback when the body names no text code", () => {
    expect(codeOf(new HttpError(500, "no"), "FALLBACK")).toBe("FALLBACK");
    expect(codeOf(new HttpError(500, "no", { code: { nested: true } }), "FALLBACK")).toBe("FALLBACK");
  });
});

// krizaka-internal#3214: the DO ingress replaces an app's 502 (and its JSON body) with its own HTML page and a 504; the headers are kept.
describe("handle", () => {
  it("names the refusal's code in a header too, so a client behind the ingress still reads it", async () => {
    const res = await handle(async () => {
      throw refuse(502, "SOVKORA_KEY", "Sovkora answered 401");
    });
    expect(res.status).toBe(502);
    expect(res.headers.get("x-error-code")).toBe("SOVKORA_KEY");
    expect(await res.json()).toMatchObject({ code: "SOVKORA_KEY" });
  });

  it("keeps the refusal's own headers, and adds no code header when the body names none", async () => {
    const busy = await handle(async () => {
      throw new HttpError(429, "busy", { code: "SOVKORA_BUSY" }, { "Retry-After": "15" });
    });
    expect(busy.headers.get("retry-after")).toBe("15");
    expect(busy.headers.get("x-error-code")).toBe("SOVKORA_BUSY");
    const bare = await handle(async () => {
      throw new HttpError(500, "no");
    });
    expect(bare.headers.get("x-error-code")).toBeNull();
  });
});
