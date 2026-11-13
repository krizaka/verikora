import { describe, expect, it } from "vitest";

import { type Migration,MIGRATIONS } from "./migrations";

/** The problems of a migration list: a version not shaped `NNNN_name`, a number used twice, a number not above the one before. */
export function migrationProblems(list: readonly Pick<Migration, "version">[]): string[] {
  const problems: string[] = [];
  let previous = 0;
  const seen = new Set<number>();
  for (const { version } of list) {
    const match = /^(\d{4})_[a-z0-9_]+$/.exec(version);
    if (!match) {
      problems.push(`${version}: not shaped NNNN_name`);
      continue;
    }
    const number = Number(match[1]);
    if (seen.has(number)) {
      problems.push(`${version}: number ${match[1]} is already used`);
    } else if (number <= previous) {
      problems.push(`${version}: number is not above ${previous}`);
    }
    seen.add(number);
    previous = Math.max(previous, number);
  }
  return problems;
}

describe("migration versions", () => {
  it("are unique and strictly increasing by number in migrations.ts", () => {
    expect(migrationProblems(MIGRATIONS)).toEqual([]);
  });

  it("refuses two migrations with one number", () => {
    const problems = migrationProblems([
      { version: "0004_signup_invitations" },
      { version: "0005_pilot_counters" },
      { version: "0005_report_refused_words" },
    ]);
    expect(problems).toEqual(["0005_report_refused_words: number 0005 is already used"]);
  });

  it("refuses a number that goes back", () => {
    expect(migrationProblems([{ version: "0003_a" }, { version: "0002_b" }])).toHaveLength(1);
  });
});
