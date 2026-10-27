import { migrate as runMigrations } from "@krizaka/db";
import { createPrivacy } from "@krizaka/privacy";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { purposeOfKey } from "./consent-purpose";
import { MIGRATION_LOCK_KEY } from "./db";
import { MIGRATIONS } from "./migrations";

/** Migration 0051 moves every stored consent into the privacy module, keeping each grant and withdrawal in order (skipped without YOMIZAKA_DB_IT=1 and a database). */
const enabled = process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL;

describe.runIf(enabled)("0051_privacy_consents", () => {
  it("keeps every consent: the live, the withdrawn, the given again, and a key that does not start with a letter", async () => {
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const name = `b53_privacy_${Date.now()}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    const connect = async () => {
      const client = await pool.connect();
      return { query: (text: string, values?: unknown[]) => client.query(text, values), release: () => client.release() };
    };
    const run = async (text: string, values?: unknown[]) => (await pool.query(text, values)).rows as never;
    try {
      await runMigrations(connect, MIGRATIONS.filter((m) => m.version < "0051_privacy_consents"), { lockKey: MIGRATION_LOCK_KEY });
      const account = async (email: string) => ((await pool.query("INSERT INTO accounts (email) VALUES ($1) RETURNING id", [email])).rows[0] as { id: string }).id;
      const eric = await account("eric@yomizaka.test");
      const ana = await account("ana@yomizaka.test");
      const consent = (id: string, key: string, granted: string, revoked: string | null) => pool.query("INSERT INTO consents (account_id, key, granted_at, revoked_at) VALUES ($1, $2, $3, $4)", [id, key, granted, revoked]);
      await consent(eric, "screening-landlord-undertaking", "2026-09-01T10:00:00Z", null); // live
      await consent(eric, "marketing", "2026-09-02T10:00:00Z", "2026-09-05T10:00:00Z"); // withdrawn
      await consent(eric, "marketing", "2026-09-10T10:00:00Z", null); // given again
      await consent(ana, "2fa-notice", "2026-09-03T10:00:00Z", null); // starts with a digit
      await consent(ana, "reminders", "2026-09-04T10:00:00Z", "2026-09-04T10:00:00Z"); // given and withdrawn at the same instant: the withdrawal has the last word
      const before = ((await pool.query("SELECT count(*)::int AS n FROM consents")).rows[0] as { n: number }).n;
      expect(await runMigrations(connect, MIGRATIONS, { lockKey: MIGRATION_LOCK_KEY })).toContain("0051_privacy_consents");

      const purposes = ["screening-landlord-undertaking", "marketing", purposeOfKey("2fa-notice"), "reminders"];
      const privacy = createPrivacy({ clock: { now: () => new Date("2026-10-27T12:00:00Z") }, purposes, contributors: [], transaction: async (work) => work(run) });
      const subject = (id: string) => ({ kind: "account", id });
      expect(await privacy.hasConsent(run, subject(eric), "screening-landlord-undertaking")).toBe(true);
      expect(await privacy.hasConsent(run, subject(eric), "marketing")).toBe(true);
      expect(await privacy.hasConsent(run, subject(ana), purposeOfKey("2fa-notice"))).toBe(true);
      expect(await privacy.hasConsent(run, subject(ana), "reminders")).toBe(false);
      // every grant and every withdrawal is a line: 5 grants + 2 withdrawals
      const lines = ((await pool.query("SELECT count(*)::int AS n FROM privacy.consent")).rows[0] as { n: number }).n;
      expect(lines).toBe(before + 2);
      const history = await privacy.consentHistory(run, subject(eric));
      expect(history.filter((c) => c.purpose === "marketing").map((c) => c.granted)).toEqual([true, false, true]);
      expect(history[0]).toMatchObject({ version: "before-privacy-module", means: "import" });
      // the digit-first key is stored under the name the code computes
      expect(purposeOfKey("2fa-notice")).toMatch(/^k-[0-9a-f]{8}$/);
      // the old table stays one release, untouched
      expect(((await pool.query("SELECT count(*)::int AS n FROM consents")).rows[0] as { n: number }).n).toBe(before);
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
