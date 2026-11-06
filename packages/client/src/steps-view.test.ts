import { checkSteps } from "@verikora/core";
import { describe, expect, it } from "vitest";

import fr from "./messages/fr.json";
import { stepperSteps } from "./steps-view";

const say = (key: string) =>
  key.split(".").reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], fr) as string;

describe("the steps of a check, as the Stepper draws them", () => {
  it("names a running compliance check's four steps and says which one is working", () => {
    const steps = stepperSteps(
      checkSteps({ hasText: true, analysis: { studio: "compliance-check", status: "running" } }),
      say,
    );
    expect(steps.map((s) => [s.title, s.status])).toEqual([
      ["Lecture", "done"],
      ["Contrôle préalable", "done"],
      ["Vérification des règles", "current"],
      ["Rapport", "upcoming"],
    ]);
    expect(steps[2]?.description).toBe("En cours…");
    expect(steps[0]).not.toHaveProperty("description");
  });

  it("calls the middle step by the Studio's own name and a failure an error", () => {
    const steps = stepperSteps(
      checkSteps({ hasText: true, analysis: { studio: "document-authenticity", status: "failed" } }),
      say,
    );
    expect(steps[2]).toMatchObject({ title: "Examen du fichier", status: "error" });
  });

  it("stops a scan with no text at the first step, for the compliance check", () => {
    const steps = stepperSteps(checkSteps({ hasText: false, analysis: null }), say);
    expect(steps.map((s) => s.status)).toEqual(["error", "upcoming", "upcoming", "upcoming"]);
  });
});
