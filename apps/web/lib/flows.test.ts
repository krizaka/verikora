import { AUDIENCES, flowDefinition } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { definitionFromForm, emptyForm, formFromDefinition } from "./flow-form";
import {
  applicantFilesOffered,
  audiencesOf,
  type AvailableFlow,
  decideStart,
  flowsFor,
  offerFor,
  seedFlows,
} from "./flows";
import { SEED_FLOWS } from "./flows-seed";

/** ADR-0003: flows are data. These are the pure rules; the SQL is in flows.integration.test.ts. */
const flow = (key: string, patch: Partial<AvailableFlow["definition"]> = {}): AvailableFlow => ({
  key,
  versionId: `${key}-v1`,
  version: 1,
  definition: { ...SEED_FLOWS[0]!.definition, ...patch },
});

describe("the seeded flows", () => {
  it("are valid definitions, one per audience of the vocabulary", () => {
    for (const s of SEED_FLOWS) expect(flowDefinition.safeParse(s.definition).success, s.key).toBe(true);
    expect(new Set(SEED_FLOWS.flatMap((s) => s.definition.audiences))).toEqual(new Set(AUDIENCES));
  });
  it("point the compliance Studio at the rulesets of the pack by jurisdiction (data, not code)", () => {
    const compliance = SEED_FLOWS[0]!.definition.steps.find((s) => s.studio === "compliance-check")!;
    expect(compliance.jurisdictions.map((j) => [j.code, j.ruleset])).toEqual([
      ["QC", "qc-residential-lease"],
      ["QC", "qc-visit-notice"],
      ["QC", "qc-premises-condition"],
      ["FR", "fr-residential-lease"],
      ["BE-WAL", "be-residential-lease"],
    ]);
  });
  it("run the Québec invoice check for the freelancer and the business flows (dev only); only the screening stays « soon »", () => {
    expect(SEED_FLOWS.filter((s) => s.definition.status === "soon").map((s) => s.key)).toEqual(["tenant-screening"]);
    for (const [key, rulesets] of [
      ["file-check-freelancer", ["qc-invoice", "qc-service-contract"]],
      ["file-check-business", ["qc-invoice"]],
    ] as const) {
      const f = SEED_FLOWS.find((s) => s.key === key)!;
      expect(f.environments).toEqual(["dev"]);
      expect(f.definition.steps.flatMap((st) => st.jurisdictions.map((j) => j.ruleset))).toEqual(rulesets);
    }
    expect(seedFlows("prod").map((f) => f.key)).toEqual(["lease-check-tenant", "lease-check-landlord"]);
  });
});

describe("what the app derives from the flows — nothing hard-coded", () => {
  it("offers an audience only when an enabled flow offers it, available when one of its flows runs today", () => {
    const flows = [flow("a", { audiences: ["tenant"] }), flow("b", { audiences: ["freelancer"], status: "soon" })];
    expect(audiencesOf(flows)).toEqual([
      { audience: "tenant", status: "available" },
      { audience: "freelancer", status: "soon" },
    ]);
    expect(audiencesOf([])).toEqual([]);
  });

  it("a disabled flow is hidden: take it out of the available list and its audience, studios and jurisdictions go with it", () => {
    const tenant = flow("tenant", { audiences: ["tenant"] });
    const both = [tenant, flow("landlord", { audiences: ["landlord"] })];
    expect(audiencesOf(both).map((a) => a.audience)).toEqual(["tenant", "landlord"]);
    expect(audiencesOf([tenant]).map((a) => a.audience)).toEqual(["tenant"]);
    expect(offerFor([], "tenant")).toEqual({ studios: [], jurisdictions: [], rulesets: [] });
  });

  it("offers on a document the Studios and jurisdictions of the person's flows (all flows until they chose a side)", () => {
    const flows = seedFlows("dev");
    expect(offerFor(flows, "tenant")).toEqual({
      studios: ["compliance-check", "document-authenticity"],
      jurisdictions: ["QC", "FR", "BE-WAL"],
      rulesets: [
        "qc-residential-lease",
        "qc-visit-notice",
        "qc-premises-condition",
        "fr-residential-lease",
        "be-residential-lease",
      ],
    });
    expect(offerFor(flows, "freelancer")).toEqual({
      studios: ["compliance-check", "document-authenticity"],
      jurisdictions: ["QC"],
      rulesets: ["qc-invoice", "qc-service-contract"],
    });
    expect(flowsFor(flows, null)).toHaveLength(flows.length);
  });
});

describe("a required consent is enforced, not only hidden", () => {
  const screening = flow("tenant-screening", { audiences: ["landlord"], consents: ["tenant-screening"] });
  it("refuses to start a flow whose consent has not been given (CONSENT_REQUIRED, naming it)", () => {
    expect(decideStart([screening], "landlord", "compliance-check", [])).toEqual({
      ok: false,
      code: "CONSENT_REQUIRED",
      missing: ["tenant-screening"],
    });
  });
  it("starts it once every consent is granted, under that flow's version", () => {
    const decision = decideStart([screening], "landlord", "compliance-check", ["tenant-screening"]);
    expect(decision).toMatchObject({ ok: true, flow: { key: "tenant-screening", versionId: "tenant-screening-v1" } });
  });
  it("refuses a Studio no enabled flow offers to this person (FLOW_NOT_OFFERED)", () => {
    expect(decideStart([screening], "tenant", "compliance-check", ["tenant-screening"])).toMatchObject({
      ok: false,
      code: "FLOW_NOT_OFFERED",
    });
    expect(decideStart([], null, "document-authenticity", [])).toMatchObject({ ok: false, code: "FLOW_NOT_OFFERED" });
  });
  it("runs a dated ruleset (qc-residential-lease/2026-10-24) under the flow that names its ruleset, and a new kind under the flow that names it", () => {
    const seeded = seedFlows("dev");
    expect(decideStart(seeded, "tenant", "compliance-check", [], "qc-residential-lease/2026-10-24")).toMatchObject({
      ok: true,
    });
    expect(decideStart(seeded, "tenant", "compliance-check", [], "qc-visit-notice")).toMatchObject({ ok: true });
    expect(decideStart(seeded, "tenant", "compliance-check", [], "qc-unknown-notice")).toMatchObject({
      ok: false,
      code: "FLOW_NOT_OFFERED",
    });
  });
  it("runs under another flow of the audience when that one needs no consent", () => {
    const free = flow("lease-check-landlord", { audiences: ["landlord"] });
    expect(decideStart([screening, free], "landlord", "compliance-check", [])).toMatchObject({
      ok: true,
      flow: { key: "lease-check-landlord" },
    });
  });
});

describe("the administration form and the definition, both ways", () => {
  it("round-trips every seeded flow", () => {
    for (const s of SEED_FLOWS)
      expect(definitionFromForm(formFromDefinition(s.definition))).toEqual(flowDefinition.parse(s.definition));
  });
  it("refuses an incomplete form (no audience, no title) — the definition's schema is the validator", () => {
    expect(() => definitionFromForm(emptyForm())).toThrow();
  });
  it("turns the price in dollars into cents", () => {
    const f = formFromDefinition(SEED_FLOWS[0]!.definition);
    expect(definitionFromForm({ ...f, pricingModel: "per-run", amount: "4.5" }).pricing).toEqual({
      model: "per-run",
      amountCents: 450,
    });
  });
});

describe("a named ruleset (the Québec invoice) is run only under a flow that carries it", () => {
  const COMPLIANCE_INVOICE = {
    id: "invoice",
    kind: "studio" as const,
    studio: "compliance-check" as const,
    pack: "document-validation",
    jurisdictions: [{ code: "QC" as const, ruleset: "qc-invoice" }],
  };
  const lease = flow("lease", { audiences: ["freelancer"] });
  const invoice = flow("invoice", { audiences: ["freelancer"], steps: [COMPLIANCE_INVOICE] });
  it("offers the ruleset only through the flows that name it", () => {
    expect(offerFor([lease], "freelancer").rulesets).not.toContain("qc-invoice");
    expect(offerFor([lease, invoice], "freelancer").rulesets).toContain("qc-invoice");
  });
  it("refuses a request for a ruleset no flow of the person carries, and runs the one that does under that flow", () => {
    expect(decideStart([lease], "freelancer", "compliance-check", [], "qc-invoice")).toMatchObject({
      ok: false,
      code: "FLOW_NOT_OFFERED",
    });
    expect(decideStart([lease, invoice], "freelancer", "compliance-check", [], "qc-invoice")).toMatchObject({
      ok: true,
      flow: { key: "invoice" },
    });
    expect(decideStart([lease, invoice], "tenant", "compliance-check", [], "qc-invoice")).toMatchObject({
      ok: false,
      code: "FLOW_NOT_OFFERED",
    });
  });
  it("leaves the plain lease check as it was", () => {
    expect(decideStart([lease, invoice], "freelancer", "compliance-check", [])).toMatchObject({
      ok: true,
      flow: { key: "lease" },
    });
  });
});

describe("the service contract is a second named ruleset of the same step", () => {
  const seeded = seedFlows("dev");
  it("is run for a freelancer under their flow, and refused for a business", () => {
    expect(decideStart(seeded, "freelancer", "compliance-check", [], "qc-service-contract")).toMatchObject({
      ok: true,
      flow: { key: "file-check-freelancer" },
    });
    expect(decideStart(seeded, "business", "compliance-check", [], "qc-service-contract")).toMatchObject({
      ok: false,
      code: "FLOW_NOT_OFFERED",
    });
  });
  it("survives the administration form: two rulesets of one jurisdiction are one comma-separated field", () => {
    const def = SEED_FLOWS.find((f) => f.key === "file-check-freelancer")!.definition;
    expect(formFromDefinition(def).rulesets.QC).toBe("qc-invoice, qc-service-contract");
    expect(definitionFromForm(formFromDefinition(def)).steps[0]!.jurisdictions.map((j) => j.ruleset)).toEqual([
      "qc-invoice",
      "qc-service-contract",
    ]);
  });
});

describe("« Dossiers » is gated by the flow (verikora#319)", () => {
  const screening = flow("tenant-screening", { audiences: ["landlord"] });
  it("is offered to the audience of the applicant-file flow, and to whoever has not chosen a side yet", () => {
    expect(applicantFilesOffered([screening], "landlord")).toBe(true);
    expect(applicantFilesOffered([screening], null)).toBe(true);
  });
  it("is not offered to another audience, nor when the flow is not enabled", () => {
    expect(applicantFilesOffered([screening], "tenant")).toBe(false);
    expect(applicantFilesOffered([flow("lease-check", { audiences: ["landlord"] })], "landlord")).toBe(false);
    expect(applicantFilesOffered([], "landlord")).toBe(false);
  });
});
