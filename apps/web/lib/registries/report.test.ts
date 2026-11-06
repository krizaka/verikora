import { describe, expect, it } from "vitest";

import { VERDICT_WORDS } from "../signal-cards";
import { registries } from "./index";
import { ANSWER, type BusinessRegistry, closedRegistry, type RegistryAnswer } from "./model";
import { registryReport } from "./report";

// Synthetic: fictitious numbers, a fake register, nothing from a real document.
const NOW = new Date("2026-10-30T15:00:00.000Z");
const qstOf = (answer: RegistryAnswer): BusinessRegistry => ({
  source: "Revenu Québec",
  lookupQst: async () => answer,
});
const closed = registries({ now: () => NOW });
const facts = (references: { kind: string; value: string }[], issuer: string | null = "Atelier Exemple Inc.") => ({
  issuer,
  references,
  dates: [{ kind: "issued", value: "2026-09-15" }],
});
const QST = { kind: "qst", value: "0000000000TQ0001" };

describe("the registry part of a document's report (verikora#627)", () => {
  it("looks nothing up when the document carries no QST number", async () => {
    let calls = 0;
    const qst: BusinessRegistry = {
      source: "Revenu Québec",
      lookupQst: async () => {
        calls += 1;
        return { kind: ANSWER.unknown };
      },
    };
    expect(await registryReport(facts([{ kind: "neq", value: "1170000001" }]), { ...closed, qst }, NOW)).toBeNull();
    expect(calls).toBe(0);
  });

  it("names its source with the API and the day it was consulted, and says GST/HST and NEQ were not looked up", async () => {
    const r = await registryReport(facts([QST]), { ...closed, qst: qstOf({ kind: ANSWER.unknown }) }, NOW);
    expect(r).toMatchObject({
      source: "Revenu Québec (SW-340)",
      consultedAt: "2026-10-30T15:00:00.000Z",
      number: "0000000000TQ0001",
      gstHst: "not-covered",
      neq: "not-authorised",
    });
    expect(r?.qst.looked).toBe(true);
  });

  it("an unknown number is REG-001, a question for the issuer", async () => {
    const r = await registryReport(facts([QST]), { ...closed, qst: qstOf({ kind: ANSWER.unknown }) }, NOW);
    expect(r?.qst.signals.map((s) => s.signalId)).toEqual(["REG-001"]);
    expect(r?.qst.signals[0]?.askFor).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(VERDICT_WORDS);
  });

  it("a revoked registration and a different name are REG-003 and REG-002, the name compared for a business only", async () => {
    const found: RegistryAnswer = {
      kind: ANSWER.found,
      status: "struck",
      statusDate: "2026-01-01",
      legalName: "Autre Nom inc.",
      tradeName: null,
    };
    const business = await registryReport(
      facts([QST, { kind: "neq", value: "1170000001" }]),
      { ...closed, qst: qstOf(found) },
      NOW,
    );
    expect(business?.qst.signals.map((s) => s.signalId).sort()).toEqual(["REG-002", "REG-003"]);
    const sole = await registryReport(
      facts([QST, { kind: "neq", value: "2270000001" }]),
      { ...closed, qst: qstOf(found) },
      NOW,
    );
    expect(sole?.qst.signals.map((s) => s.signalId)).toEqual(["REG-003"]);
    expect(JSON.stringify(sole)).not.toContain("Autre Nom");
  });

  it("a register that did not answer is « not looked up » with its reason, and raises nothing", async () => {
    const r = await registryReport(
      facts([QST]),
      { ...closed, qst: closedRegistry("Revenu Québec", "unavailable") },
      NOW,
    );
    expect(r?.qst).toEqual({ looked: false, reason: "unavailable", signals: [] });
  });
});
