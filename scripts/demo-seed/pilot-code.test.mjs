import { expect, test } from "vitest";

import { DEV_PILOT_CODE, DEV_PILOT_FILES, seedPilotCode } from "./pilot-code.mjs";

test("the dev pilot code is a demo credit code of one file that falls back to paid credits; seeded twice it is written once", async () => {
  const calls = [];
  let written = false;
  const run = async (sql, values) => {
    calls.push({ sql, values });
    if (written) return [];
    written = true;
    return [{ id: values[0] }];
  };
  expect(await seedPilotCode(run, new Date("2026-11-13T00:00:00Z"))).toBe(true);
  expect(await seedPilotCode(run, new Date("2026-11-13T00:00:00Z"))).toBe(false);
  expect(calls[0].sql).toMatch(/'credit', 'demo'/);
  expect(calls[0].sql).toMatch(/fallback_paid/);
  expect(calls[0].sql).toMatch(/ON CONFLICT \(code_key\) DO NOTHING/);
  expect(calls[0].values[1]).toBe(DEV_PILOT_CODE);
  expect(calls[0].values[4]).toBe(DEV_PILOT_FILES);
  expect(DEV_PILOT_FILES).toBe(1);
});
