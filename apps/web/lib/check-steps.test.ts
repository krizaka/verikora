import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/** A check's progress is Krizaka UI's Stepper fed by the shared core contract (krizaka/verikora#208): nothing hand-made, nothing invented. */
describe("the check's steps on the document page", () => {
  it("are drawn with @krizaka/ui's Stepper from @verikora/core's checkSteps, in the document view", () => {
    const steps = read("components/console/CheckSteps.tsx");
    expect(steps).toContain('from "@krizaka/ui/stepper"');
    expect(steps).toContain("@verikora/core");
    expect(steps).not.toMatch(/<ol\b/);
    const view = read("components/console/DocumentReportTab.tsx");
    expect(view).toMatch(/<CheckSteps\s+steps=\{checkSteps\(/);
  });

  it("are named in both languages: the four steps, the rules step per Studio, and the four states", () => {
    for (const messages of [en, fr]) {
      const s = messages.console.steps;
      for (const key of ["read", "preflight", "report", "label", "working"] as const)
        expect(s[key].length).toBeGreaterThan(2);
      expect(Object.keys(s.rules).sort()).toEqual(["compliance-check", "document-authenticity"]);
      expect(Object.keys(s.state).sort()).toEqual(["current", "done", "error", "upcoming"]);
    }
    expect(fr.console.steps.read).toBe("Lecture");
    expect(fr.console.steps.preflight).toBe("Contrôle préalable");
    expect(fr.console.steps.rules["compliance-check"]).toBe("Vérification des règles");
    expect(fr.console.steps.report).toBe("Rapport");
  });
});
