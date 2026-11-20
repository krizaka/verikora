import { defineContract, text } from "@krizaka/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GET } from "./route";

/** What App Platform and the monitors read: a status and the version, both non-empty. */
export const healthzContract = defineContract("healthz", z.object({ status: z.literal("ok"), version: text() }));

describe("GET /api/healthz", () => {
  it("answers 200 with the contract: status ok and a non-empty version", async () => {
    const body = await healthzContract.expect(GET());
    expect(body.status).toBe("ok");
  });
});
