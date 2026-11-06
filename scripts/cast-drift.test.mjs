// Drift guard (krizaka/.github#356): the demo cast of `@krizaka/org` is the only source of the personas' names. No source file spells
// a persona or shows a « qa » / « admin » account as a display name; the seed and the QA accounts take their names from the cast.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { castOf } from "@krizaka/org";

import { accountsFromEnv, QA_PERSONAS } from "../apps/web/scripts/qa-accounts.mjs";
import { castAccounts, CAST_ADMIN, CAST_MEMBER, LOCAL_PASSWORD, matchesRecorded } from "./demo-seed/cast.mjs";
import { PERSONAS } from "./demo-seed/seed.mjs";

const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mjs", "*.json"], {
  encoding: "utf8",
  cwd: new URL("..", import.meta.url),
})
  .split("\n")
  .filter((f) => f && !/\.test\.|\/__tests__\/|pnpm-lock|dev-preview\.json/.test(f));

describe("the cast is the only source of the personas", () => {
  it("spells no persona's name outside the cast (tests may use it as a fixture)", () => {
    const names = castOf("yomizaka").map((p) => p.displayName);
    const offenders = files.filter((f) =>
      names.some((n) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").includes(n)),
    );
    expect(offenders).toEqual([]);
  });

  it("never shows a qa or admin account as a display name", () => {
    const offenders = files.filter((f) =>
      /name:\s*["'`](qa[ _-]?(user|admin)|admin|administrator)["'`]/i.test(
        readFileSync(new URL(`../${f}`, import.meta.url), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("names the seeded member and the QA accounts after their personas", () => {
    expect(PERSONAS[CAST_MEMBER.id].name).toBe(CAST_MEMBER.displayName);
    expect(QA_PERSONAS.USER).toEqual(CAST_MEMBER);
    expect(QA_PERSONAS.ADMIN).toEqual(CAST_ADMIN);
    const env = {
      QA_USER_EMAIL: "a@x.test",
      QA_USER_PASSWORD: "x".repeat(14),
      QA_ADMIN_EMAIL: "b@x.test",
      QA_ADMIN_PASSWORD: "y".repeat(14),
    };
    expect(accountsFromEnv(env).map((a) => a.name)).toEqual([CAST_MEMBER.displayName, CAST_ADMIN.displayName]);
  });

  it("gives the cast accounts from the environment, and a default password only on this machine", () => {
    const env = {
      DATABASE_URL: "postgres://u@db.example.com/x",
      QA_USER_EMAIL: "A@x.test",
      QA_USER_PASSWORD: "x".repeat(14),
      QA_ADMIN_EMAIL: "b@x.test",
      QA_ADMIN_PASSWORD: "y".repeat(14),
      QA_CAMILLE_EMAIL: "c@x.test",
      QA_CAMILLE_PASSWORD: "z".repeat(14),
    };
    expect(castAccounts(env).map((a) => [a.persona.id, a.email, a.role])).toEqual([
      ["eric", "a@x.test", "USER"],
      ["mira", "b@x.test", "ADMIN"],
      ["camille", "c@x.test", "USER"],
    ]);
    expect(() => castAccounts({ DATABASE_URL: "postgres://u@db.example.com/x" })).toThrow(/password/);
    const local = castAccounts({ DATABASE_URL: "postgres://u:p@localhost:5432/x" });
    expect(local.map((a) => a.password)).toEqual([LOCAL_PASSWORD, LOCAL_PASSWORD, LOCAL_PASSWORD]);
    expect(local.map((a) => a.email)).toEqual([
      "eric@demo.verikora.test",
      "mira@demo.verikora.test",
      "camille@demo.verikora.test",
    ]);
  });

  it("compares a local database exactly, and the lived-in dev one by « everything recorded is there » (accounts still exact)", () => {
    const recorded = "accounts=3;analyses=7;collections=8;documents=16;file_report_shares=2;screenings=1";
    expect(matchesRecorded(recorded, recorded, true)).toBe(true);
    const lived = "accounts=3;analyses=13;collections=8;documents=25;file_report_shares=2;screenings=1";
    expect(matchesRecorded(lived, recorded, true)).toBe(false);
    expect(matchesRecorded(lived, recorded, false)).toBe(true);
    expect(
      matchesRecorded(
        "accounts=3;analyses=6;collections=8;documents=16;file_report_shares=2;screenings=1",
        recorded,
        false,
      ),
    ).toBe(false);
    expect(
      matchesRecorded(
        "accounts=4;analyses=7;collections=8;documents=16;file_report_shares=2;screenings=1",
        recorded,
        false,
      ),
    ).toBe(false);
  });
});
