import { ANALYSIS_STATUS } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { pollInterval } from "./LiveAnalysis";

describe("a running analysis is asked again (verikora#320, #110)", () => {
  it("every 3 s while it runs, never once it ended", () => {
    expect(pollInterval(ANALYSIS_STATUS.running)).toBe(3000);
    for (const status of [ANALYSIS_STATUS.succeeded, ANALYSIS_STATUS.failed, ANALYSIS_STATUS.cancelled, undefined])
      expect(pollInterval(status)).toBe(false);
  });
});
