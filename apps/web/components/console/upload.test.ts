import { describe, expect, it } from "vitest";

import { isPhotoFile, refusalCode, translated } from "./upload";

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
