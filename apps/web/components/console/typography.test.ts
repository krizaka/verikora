import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Plain typography in the app (design § 3.4, P5, verikora#322): the sans for everything, a mono only for code and identifiers
 * inside « Détails techniques » — and a run id cut to one line in a table (`RunId`, verikora#457). A `font-mono` class is allowed only in the components that draw those details.
 */
const TECHNICAL_DETAILS: Record<string, readonly string[]> = {
  "ReportFace.tsx": ["TechnicalDetails"],
  "DocumentFileTab.tsx": ["FileTechnicalDetails"],
  "RunId.tsx": ["RunId"],
};
const DIRS = [join(__dirname), join(__dirname, "../../../desktop/src/components")];

/** Each `font-mono` of a source file, with the function it sits in (the nearest declaration above it). */
function monoSites(source: string): string[] {
  const sites: string[] = [];
  for (const m of source.matchAll(/font-mono/g)) {
    const before = source.slice(0, m.index);
    const decl = [...before.matchAll(/(?:^|\n)(?:export )?(?:async )?function (\w+)/g)].pop();
    sites.push(decl?.[1] ?? "(top level)");
  }
  return sites;
}

describe("plain typography in the app (P5)", () => {
  const files = DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
      .map((f) => ({ name: f, source: readFileSync(join(dir, f), "utf8") })),
  );

  it("reads the console's components and the Mac app's", () => {
    expect(files.some((f) => f.name === "ReportFace.tsx")).toBe(true);
    expect(files.some((f) => f.name === "CheckView.tsx" && f.source.includes("@tauri-apps"))).toBe(true);
  });

  it("uses a mono only under « Détails techniques »", () => {
    const outside = files.flatMap((f) =>
      monoSites(f.source)
        .filter((fn) => !(TECHNICAL_DETAILS[f.name] ?? []).includes(fn))
        .map((fn) => `${f.name} › ${fn}`),
    );
    expect(outside).toEqual([]);
  });

  it("never draws a serif face", () => {
    expect(files.filter((f) => /font-serif|Young Serif|Courier/.test(f.source)).map((f) => f.name)).toEqual([]);
  });

  it("keeps the run id and the hashes in the technical details, in the mono", () => {
    const report = files.find((f) => f.name === "ReportFace.tsx")!.source;
    expect(monoSites(report)).toContain("TechnicalDetails");
    const file = files.find((f) => f.name === "DocumentFileTab.tsx")!.source;
    expect(monoSites(file)).toEqual(["FileTechnicalDetails"]);
  });
});
