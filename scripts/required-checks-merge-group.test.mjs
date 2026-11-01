import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// A check required by main's protection must report on the merge queue entry too, or the entry waits
// 60 minutes and leaves the queue (« checks_timed_out »: visual.yml had no merge_group trigger, #696).
describe("required checks report in the merge queue", () => {
  for (const file of ["visual", "ci", "mobile-ci", "security"]) {
    it(`${file}.yml triggers on merge_group`, () => {
      expect(read(`.github/workflows/${file}.yml`)).toMatch(/^\s*merge_group:/m);
    });
  }
});
