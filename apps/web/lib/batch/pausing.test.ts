import { describe, expect, it } from "vitest";

import { PAUSE_FOR_ACCOUNT, PAUSE_FOR_ENGINE, pausesBatch, waitsForAccount, waitsForEngine } from "./pausing";

describe("why a batch waits (verikora#248)", () => {
  it("waits for the account to pay, or for the engine to have room — never fails every next row", () => {
    for (const code of [...PAUSE_FOR_ACCOUNT, ...PAUSE_FOR_ENGINE]) expect(pausesBatch(code), code).toBe(true);
    expect(PAUSE_FOR_ENGINE).toContain("SOVKORA_BUSY");
    expect(PAUSE_FOR_ENGINE).toContain("SOVKORA_UNAVAILABLE");
  });

  it("a refusal about one row (no text, not kept, a bad key…) is that row's own and does not pause the batch", () => {
    for (const code of ["NO_TEXT", "NOT_KEPT", "SOVKORA_KEY", "SOVKORA_INPUT", "FAILED", "UNSUPPORTED_TYPE"])
      expect(pausesBatch(code), code).toBe(false);
  });

  it("the page offers billing only for the account's pause, and keeps polling for the engine's", () => {
    expect(waitsForAccount("PAYWALL")).toBe(true);
    expect(waitsForAccount("SOVKORA_BUSY")).toBe(false);
    expect(waitsForEngine("SOVKORA_BUSY")).toBe(true);
    expect(waitsForEngine("PAYWALL")).toBe(false);
    expect([waitsForAccount(null), waitsForEngine(null)]).toEqual([false, false]);
  });
});
