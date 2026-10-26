import { beforeAll, describe, expect, it } from "vitest";

import { migrate } from "../db";
import { pgIdempotency, pgSuppression } from "./store";

/** The mail memory in PostgreSQL (yomizaka#48): CI's service; locally YOMIZAKA_DB_IT=1 DATABASE_URL=…. */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

describe.runIf(enabled)("the suppression list and the intentions already mailed", () => {
  beforeAll(async () => {
    await migrate();
  });

  it("remembers an address the provider reported, whatever its case, and a second report changes nothing", async () => {
    const email = `Bounced-${stamp}@Example.test`;
    expect(await pgSuppression.has(email)).toBe(false);
    await pgSuppression.add(email, "bounce");
    await pgSuppression.add(email, "complaint");
    expect(await pgSuppression.has(email.toLowerCase())).toBe(true);
    expect(await pgSuppression.has(`other-${stamp}@example.test`)).toBe(false);
  });

  it("claims an intention once, and gives it back when the send failed", async () => {
    const key = `confirmEmail:${stamp}`;
    expect(await pgIdempotency.claim(key)).toBe(true);
    expect(await pgIdempotency.claim(key)).toBe(false);
    await pgIdempotency.release(key);
    expect(await pgIdempotency.claim(key)).toBe(true);
  });
});
