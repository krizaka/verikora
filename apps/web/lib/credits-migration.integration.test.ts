import { createCredits } from "@krizaka/credits";
import { migrate as runMigrations } from "@krizaka/db";
import { describe, expect, it } from "vitest";

import { MIGRATION_LOCK_KEY } from "./db";
import { withScratchDatabase } from "./migration-testkit";
import { MIGRATIONS } from "./migrations";

/** Migration 0050 turns the columns of the entitlements into the credits ledger, losing nothing (skipped without YOMIZAKA_DB_IT=1 and a database). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-27T12:00:00Z");

describe.runIf(enabled)("0050_credits_ledger", () => {
  it("keeps every paid credit and every used free audit, and a replay of the runtime's keys changes nothing", async () => {
    await withScratchDatabase("b53_credits", async ({ connect, run, pool }) => {
      await runMigrations(connect, MIGRATIONS.filter((m) => m.version < "0050_credits_ledger"), { lockKey: MIGRATION_LOCK_KEY });
      const make = async (email: string, credits: number, freeUsed: boolean, selfServe = true) =>
        ((await pool.query("INSERT INTO accounts (email, audit_credits, free_audit_used_at, terms_accepted_at) VALUES ($1, $2, $3, $4) RETURNING id", [email, credits, freeUsed ? "2026-10-01T10:00:00Z" : null, selfServe ? "2026-09-01T10:00:00Z" : null])).rows[0] as { id: string }).id;
      const paid = await make("paid@yomizaka.test", 7, false);
      const both = await make("both@yomizaka.test", 3, true);
      const fresh = await make("fresh@yomizaka.test", 0, false);
      const usedOnly = await make("used@yomizaka.test", 0, true);
      const exempt = await make("exempt@yomizaka.test", 0, true, false);
      await runMigrations(connect, MIGRATIONS, { lockKey: MIGRATION_LOCK_KEY });

      const credits = createCredits({ clock: { now: () => NOW }, settings: { timeZone: "America/Toronto", holdTtlSeconds: 900 } });
      const balance = async (id: string) => credits.balance(run, id);
      expect((await balance(paid)).purchased).toBe(7);
      expect((await balance(both)).purchased).toBe(3);
      expect(await balance(fresh)).toMatchObject({ total: 0 });
      expect(await balance(exempt)).toMatchObject({ total: 0 });
      // the free audit that was used is a pot of one, spent: nothing is left, and the runtime's own key finds it instead of granting a second one
      expect((await balance(usedOnly)).granted).toBe(0);
      const replay = await credits.grant(run, { accountId: usedOnly, amount: 1, expiresAt: new Date("2030-01-01T00:00:00Z"), onExhausted: "fallback_paid", source: "free-audit", idempotencyKey: `free-audit-${usedOnly}` });
      expect(replay.replayed).toBe(true);
      expect((await balance(usedOnly)).granted).toBe(0);
      const again = await credits.purchase(run, { accountId: paid, amount: 7, source: "import:audit_credits", idempotencyKey: `import-${paid}` });
      expect(again.replayed).toBe(true);
      expect((await balance(paid)).purchased).toBe(7);
      // the columns stay for one release, untouched
      expect((await pool.query("SELECT audit_credits FROM accounts WHERE id = $1", [paid])).rows[0].audit_credits).toBe(7);
    });
  });
});
