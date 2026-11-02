import { JURISDICTIONS } from "@yomizaka/core";
import { describe, expect, it } from "vitest";

import { LEASE_REFS, leaseRefOn } from "../../../scripts/smoke-lease-check.mjs";
import { runInputs } from "./analyses";
import { rulesFor } from "./check-flow";
import contract from "./orazaka-contract/compliance-check-inputs.json";
import { CHECK_KINDS, rulesetFor } from "./rulesets";

/* The contract test of the Yomizaka -> Orazaka call (the 10-29 refusal « Orazaka refused the document as sent »): every run the UI can
 * start is turned into the Studio's inputs and checked against the Studio's own input schema, the one the engine enforces. */

type Property = { type: string; enum?: string[]; pattern?: string; maxLength?: number };
type Schema = { required: string[]; properties: Record<string, Property> };

function violations(inputs: Record<string, string>, schema: Schema): string[] {
  const found: string[] = [];
  for (const key of schema.required) if (!(key in inputs)) found.push(`${key} is required`);
  for (const [key, value] of Object.entries(inputs)) {
    const property = schema.properties[key];
    if (!property) found.push(`${key} is not an input of the Studio`);
    else if (property.enum && !property.enum.includes(value))
      found.push(`${key}: '${value}' is not one of ${property.enum.join(", ")}`);
    else if (property.pattern && !new RegExp(property.pattern).test(value))
      found.push(`${key}: '${value}' does not match ${property.pattern}`);
    else if (property.maxLength && value.length > property.maxLength)
      found.push(`${key} is longer than ${property.maxLength}`);
  }
  return found;
}

const doc = { mimeType: "text/plain", text: "BAIL DE LOGEMENT\nLoyer mensuel : 1 225,00 $", content: Buffer.from("x") };
const DAYS = ["2024-03-01", "2026-05-01", "2026-10-23", "2026-10-24", "2026-10-29"];

function everyRequest() {
  const requests = [];
  for (const kind of CHECK_KINDS)
    for (const jurisdiction of JURISDICTIONS)
      for (const asOf of DAYS) {
        const request = rulesFor(kind, jurisdiction, asOf);
        if (request) requests.push({ kind, jurisdiction, asOf, request });
      }
  return requests;
}

describe("what Yomizaka sends to the compliance Studio is what the Studio accepts", () => {
  const requests = everyRequest();
  it("covers a lease, an invoice, a service contract, a visit notice and an état des lieux", () => {
    expect(new Set(requests.map((r) => r.kind))).toEqual(new Set(CHECK_KINDS));
  });
  it("sends the lease of a Québec day the Studio accepts, with no ruleset input (the date picks the version)", () => {
    const { request } = requests.find((r) => r.kind === "lease" && r.jurisdiction === "QC" && r.asOf === "2026-10-29")!;
    expect(runInputs(request, doc, new Date("2026-10-29T15:00:00Z"))).toEqual({
      document: doc.text,
      jurisdiction: "QC",
      asOf: "2026-10-29",
    });
  });
  it.each(requests.map((r) => [`${r.kind} ${r.jurisdiction} ${r.asOf}`, r] as const))(
    "%s is valid for the Studio 2.0",
    (_name, { request }) => {
      expect(
        violations(runInputs(request, doc, new Date("2026-10-29T15:00:00Z")), contract.versions["2.0.0"] as Schema),
      ).toEqual([]);
    },
  );
  it.each(
    requests
      .filter((r) => r.kind === "lease" || r.kind === "invoice" || r.kind === "contract")
      .map((r) => [`${r.kind} ${r.jurisdiction} ${r.asOf}`, r] as const),
  )("%s is also valid for an installation still pinned on 1.x", (_name, { request }) => {
    expect(
      violations(runInputs(request, doc, new Date("2026-10-29T15:00:00Z")), contract.versions["1.7.2"] as Schema),
    ).toEqual([]);
  });
});

describe("the post-deploy smoke asks for the lease the way the UI does", () => {
  it.each(DAYS)("the lease reference on %s is the UI's", (day) => {
    const choice = rulesetFor("lease", "QC", day);
    expect(leaseRefOn(day)).toBe(choice.verified ? choice.ruleset : null);
  });
  it("knows every version of the Québec lease", () => {
    expect(LEASE_REFS.map((v) => v.ref)).toEqual([
      "qc-residential-lease/2024-02-21",
      "qc-residential-lease/2026-10-24",
    ]);
  });
});
