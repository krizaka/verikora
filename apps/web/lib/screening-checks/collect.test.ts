import { describe, expect, it } from "vitest";

import { decide } from "./collect";
import type { CheckResult } from "./model";
import { demoProvider } from "./providers";

const NOW = new Date("2026-10-27T12:00:00Z");
const result = (outcome: CheckResult["outcome"]): CheckResult => ({ outcome, refusal: null, category: "NONE", providerRef: "r" });

describe("what follows a poll (yomizaka#134)", () => {
  it("settles on any answer, including an error or a timeout", () => {
    for (const o of ["MATCH", "NO_MATCH", "PROVIDER_ERROR", "TIMEOUT", "REFUSED"] as const) expect(decide(result(o), 0, 96, 15, NOW)).toEqual({ settle: result(o) });
  });
  it("asks again after the provider's interval while it is still pending", () => {
    expect(decide(result("PENDING"), 3, 96, 15, NOW)).toEqual({ later: new Date("2026-10-27T12:15:00Z") });
  });
  it("gives up when the provider's tries are spent, never keeping a check pending for good", () => {
    expect(decide(result("PENDING"), 95, 96, 15, NOW)).toEqual({ giveUp: true });
  });
});

describe("the demo provider's pending file", () => {
  const call = (lastName: string) => ({ userId: "u", runId: "r", subject: { subjectId: "s", firstName: "A", lastName }, region: "QC" });
  it("is accepted, then answered on collection; one name stays pending", async () => {
    const pending = await demoProvider.submit("COURT_RECORDS", call("Wait"));
    expect(pending).toMatchObject({ outcome: "PENDING", providerRef: "demo-pending-01" });
    expect(await demoProvider.collect("COURT_RECORDS", call("Wait"), "demo-pending-01")).toMatchObject({ outcome: "NO_MATCH" });
    const forever = await demoProvider.submit("COURT_RECORDS", call("Waitforever"));
    expect(await demoProvider.collect("COURT_RECORDS", call("Waitforever"), forever.providerRef!)).toMatchObject({ outcome: "PENDING" });
  });
});
