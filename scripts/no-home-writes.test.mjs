import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

/*
 * No script, journey, demo or recorder writes in a person's home (founder, 2026-11-06: a demo folder appeared in his
 * Documents folder). A script that needs a folder uses the CI runner's temp or `$KRIZAKA_WORKSPACE/tmp`; the only home
 * paths allowed are the app's own data folder under ~/Library/Application Support (the desktop journey's `scope.json`)
 * and the Krizaka workspace.
 */
const ROOTS = ["scripts", "apps/web/scripts", "apps/web/e2e", "apps/mobile/.maestro", "deploy", ".github"];
const PERSONAL = "(Documents|Desktop|Downloads)";
const HOME_WRITE = [
  new RegExp(`~/${PERSONAL}\\b`),
  new RegExp(`\\$HOME/${PERSONAL}\\b`),
  /join\(\s*(home|homedir\(\)|os\.homedir\(\)|process\.env\.HOME)\s*,\s*"(?!Library"|krizaka-workspace")/,
];
const SELF = "scripts/no-home-writes.test.mjs";

const files = () =>
  execFileSync("git", ["ls-files", "--", ...ROOTS], { encoding: "utf8", cwd: new URL("..", import.meta.url) })
    .split("\n")
    .filter((f) => f && f !== SELF && /\.(m?[jt]s|sh|ya?ml)$/.test(f));

describe("no script writes in the home", () => {
  it("finds no path under the home but the app's own data folder and the Krizaka workspace", () => {
    const found = files().flatMap((f) => {
      const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      return text
        .split("\n")
        .map((line, i) => [line, i + 1])
        .filter(([line]) => HOME_WRITE.some((rx) => rx.test(line)))
        .map(([line, n]) => `${f}:${n}: ${line.trim()}`);
    });
    assert.deepEqual(found, []);
  });

  it("refuses the folder the Mac journey used to make in the home, and a demo folder in the person's documents", () => {
    assert.ok(HOME_WRITE[2].test('const folder = join(home, "Leases");'));
    assert.ok(!HOME_WRITE[2].test('join(home, "Library", "Application Support", IDENTIFIER, "scope.json")'));
    assert.ok(HOME_WRITE[0].test(`mkdir -p ~/${"Documents"}/Verikora-demo`));
  });
});
