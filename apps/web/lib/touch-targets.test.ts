import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8");

/** The page audit's ratchet (krizaka-internal#1903): the document and report pages hold no control under 44 px. */
describe("touch targets of the document and report pages", () => {
  it("holds the signed-in header's controls to 44 px", () => {
    expect(read("app/globals.css")).toMatch(
      /header\.sticky :is\(a, button\) \{\s*min-height: 2\.75rem;\s*min-width: 2\.75rem;/,
    );
  });

  it.each([
    ["components/console/DocumentActions.tsx", 3],
    ["components/console/StorageNotice.tsx", 2],
    ["components/console/StartChecks.tsx", 1],
    ["components/console/ReportFace.tsx", 4],
    ["components/console/DocumentFileTab.tsx", 1],
    ["components/console/DocumentView.tsx", 3],
  ])("%s: its controls carry min-h-11", (file, count) => {
    expect(read(file).match(/min-h-11/g)?.length ?? 0).toBeGreaterThanOrEqual(count);
  });
});
