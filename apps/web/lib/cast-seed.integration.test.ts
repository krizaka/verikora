import { readFileSync } from "node:fs";

import { hashPassword } from "@krizaka/auth";
import { personaByRole } from "@krizaka/org";
import { beforeAll, describe, expect, it } from "vitest";

import { seedCast, seedPersona } from "../../../scripts/demo-seed/seed.mjs";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { migrate, query } from "./db";

/**
 * `pnpm run dev:seed` against a real PostgreSQL (skipped without DATABASE_IT=1 and DATABASE_URL): the cast is seeded twice with
 * the same result, the accounts wear their persona's name, and the data set is the recorded fingerprint — the one the dev
 * deployment is checked against (krizaka/.github#356).
 */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
// On this machine or in CI: the default addresses and the local defaults of the cast apply.
const env = { DATABASE_URL: process.env.DATABASE_URL };
const q = (sql: string, values?: unknown[]) => query(sql, values as never) as Promise<Record<string, never>[]>;

describe.runIf(enabled)("the cast seed", () => {
  beforeAll(async () => {
    await migrate();
  });

  it("is idempotent, names the accounts after the cast, and leaves the recorded data set", async () => {
    const run = () => seedCast(q as never, { env, hashPassword, messagesByLocale: { fr, en } });
    // Another seed ran first in this database (tests share it): the file's fixed tokens belong to the cast's member all the same.
    await seedPersona(q as never, { email: `earlier-${Date.now()}@demo.verikora.test`, messagesByLocale: { fr, en } });
    const first = await run();
    const second = await run();
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.member.name).toBe(personaByRole("verikora", "member").displayName);
    const [admin] = await q("SELECT name, role, perspective FROM accounts WHERE email = $1", [
      "mira@demo.verikora.test",
    ]);
    expect(admin).toEqual({
      name: personaByRole("verikora", "admin").displayName,
      role: "ADMIN",
      perspective: "landlord",
    });
    // Camille is the first-run journey's new account: no perspective, even after a re-seed (krizaka-internal#2291).
    const [camille] = await q("SELECT perspective FROM accounts WHERE email = $1", ["camille@demo.verikora.test"]);
    expect(camille).toEqual({ perspective: null });
    const recorded = JSON.parse(
      readFileSync(new URL("../../../scripts/demo-seed/fingerprint.json", import.meta.url), "utf8"),
    ) as { fingerprint: string };
    expect(first.fingerprint).toBe(recorded.fingerprint);
  });
});
