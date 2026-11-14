// precheck.json (read by krizaka-precheck before a push) must name only the schema's keys and what exists (krizaka-internal#3537).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "vitest";

const root = new URL("../", import.meta.url);
const precheck = JSON.parse(readFileSync(new URL("precheck.json", root), "utf8"));
const rootScripts = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).scripts;

test("every check names itself, its paths and a command, and only the schema's keys", () => {
  assert.deepEqual(
    Object.keys(precheck).filter((k) => !["$schema", "budgetSeconds", "checks"].includes(k)),
    [],
  );
  assert.ok(Number.isInteger(precheck.budgetSeconds) && precheck.budgetSeconds <= 3600);
  const allowed = ["name", "paths", "run", "cwd", "heavy", "timeoutSeconds"];
  for (const check of precheck.checks) {
    assert.deepEqual(
      Object.keys(check).filter((k) => !allowed.includes(k)),
      [],
      check.name,
    );
    assert.ok(check.name && check.paths.length > 0 && check.run.length > 0, check.name);
  }
});

test("every folder a check runs in, and every root script it calls, exists", () => {
  for (const check of precheck.checks) {
    if (check.cwd) assert.ok(existsSync(new URL(`${check.cwd}/`, root)), `${check.name}: ${check.cwd}`);
    if (check.run[0] === "pnpm" && check.run[1] === "run") {
      assert.ok(rootScripts[check.run[2]], `${check.name}: no root script ${check.run[2]}`);
    }
  }
});

test("a prettier failure is caught: the format check covers every extension the CI's format:check does", () => {
  const format = precheck.checks.find((c) => c.run.join(" ") === "pnpm run format:check");
  assert.ok(format, "no format check");
  for (const ext of ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css"]) {
    assert.ok(format.paths.includes(`**/*.${ext}`), ext);
  }
});
