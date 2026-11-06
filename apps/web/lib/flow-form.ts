import { AUDIENCES, type FlowDefinition, flowDefinition, JURISDICTIONS } from "@verikora/core";

/**
 * The administration form of a flow and its definition, both ways (pure: tested). The form is flat — booleans for what is
 * offered, text for the words — so it fits Krizaka UI's form; the definition is what is stored (ADR-0003).
 */
export interface FlowFormValues {
  titleEn: string;
  titleFr: string;
  leadEn: string;
  leadFr: string;
  status: "available" | "soon";
  aud: Record<(typeof AUDIENCES)[number], boolean>;
  compliance: boolean;
  authenticity: boolean;
  jur: Record<(typeof JURISDICTIONS)[number], boolean>;
  rulesets: Record<(typeof JURISDICTIONS)[number], string>;
  consents: string;
  providers: string;
  pricingModel: "free" | "per-run" | "subscription";
  amount: string;
}

export const DEFAULT_RULESETS: FlowFormValues["rulesets"] = {
  QC: "qc-residential-lease",
  FR: "fr-residential-lease",
  "BE-WAL": "be-residential-lease",
};
const PACK = "document-validation";
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export const emptyForm = (): FlowFormValues => ({
  titleEn: "",
  titleFr: "",
  leadEn: "",
  leadFr: "",
  status: "available",
  aud: { tenant: false, landlord: false, freelancer: false, business: false },
  compliance: true,
  authenticity: false,
  jur: { QC: true, FR: false, "BE-WAL": false },
  rulesets: { ...DEFAULT_RULESETS },
  consents: "",
  providers: "",
  pricingModel: "free",
  amount: "",
});

export function definitionFromForm(v: FlowFormValues): FlowDefinition {
  const steps: FlowDefinition["steps"] = [];
  if (v.compliance)
    steps.push({
      id: "compliance",
      kind: "studio",
      studio: "compliance-check",
      pack: PACK,
      jurisdictions: JURISDICTIONS.filter((j) => v.jur[j]).flatMap((code) =>
        csv(v.rulesets[code]).map((ruleset) => ({ code, ruleset })),
      ),
    });
  if (v.authenticity)
    steps.push({ id: "authenticity", kind: "studio", studio: "document-authenticity", pack: PACK, jurisdictions: [] });
  for (const provider of csv(v.providers))
    steps.push({ id: `provider-${provider}`.slice(0, 40), kind: "provider", provider, jurisdictions: [] });
  const amount = v.amount.trim() === "" ? undefined : Math.round(Number(v.amount) * 100);
  return flowDefinition.parse({
    title: { en: v.titleEn, fr: v.titleFr },
    lead: { en: v.leadEn, fr: v.leadFr },
    status: v.status,
    audiences: AUDIENCES.filter((a) => v.aud[a]),
    steps,
    consents: csv(v.consents),
    providers: csv(v.providers),
    pricing: {
      model: v.pricingModel,
      ...(amount !== undefined && Number.isFinite(amount) ? { amountCents: amount } : {}),
    },
  });
}

export function formFromDefinition(d: FlowDefinition): FlowFormValues {
  const form = emptyForm();
  const compliance = d.steps.find((s) => s.studio === "compliance-check");
  form.titleEn = d.title.en;
  form.titleFr = d.title.fr;
  form.leadEn = d.lead.en;
  form.leadFr = d.lead.fr;
  form.status = d.status;
  for (const a of AUDIENCES) form.aud[a] = d.audiences.includes(a);
  form.compliance = !!compliance;
  form.authenticity = d.steps.some((s) => s.studio === "document-authenticity");
  for (const j of JURISDICTIONS) form.jur[j] = !!compliance?.jurisdictions.some((x) => x.code === j);
  // Several rulesets of one jurisdiction (the lease and the invoice) are one comma-separated field.
  for (const j of JURISDICTIONS)
    form.rulesets[j] =
      (compliance?.jurisdictions ?? [])
        .filter((x) => x.code === j)
        .map((x) => x.ruleset)
        .join(", ") || DEFAULT_RULESETS[j];
  form.consents = d.consents.join(", ");
  form.providers = d.providers.join(", ");
  form.pricingModel = d.pricing.model;
  form.amount = d.pricing.amountCents === undefined ? "" : String(d.pricing.amountCents / 100);
  return form;
}
