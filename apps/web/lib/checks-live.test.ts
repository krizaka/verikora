import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runningChecks } from "./checks-live";

const check = (id: string, result: "analysing" | "checked" | "attention" | "failed" | "stored") => ({ id, result });

describe("the checks still running", () => {
  it("are the ones the page refreshes from Sovkora before listing, and the reason the view asks again", () => {
    expect(
      runningChecks([
        check("a1", "analysing"),
        check("a2", "checked"),
        check("a3", "attention"),
        check("a4", "analysing"),
        check("a5", "failed"),
      ]).map((c) => c.id),
    ).toEqual(["a1", "a4"]);
    expect(runningChecks([])).toEqual([]);
  });
  it("lives in a client-safe module: the view never imports the database side of the checks at run time", () => {
    const view = readFileSync(join(__dirname, "../components/console/ChecksView.tsx"), "utf8");
    expect(view).toContain('from "@/lib/checks-live"');
    expect(view).not.toMatch(/^import \{[^}]*\} from "@\/lib\/checks";/m);
    expect(readFileSync(join(__dirname, "checks-live.ts"), "utf8")).not.toMatch(
      /from "\.\/db"|from "\.\/checks"|node:/,
    );
  });
});
