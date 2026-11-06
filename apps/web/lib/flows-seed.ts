import type { FlowDefinition, FlowEnvironment } from "@verikora/core";

/**
 * The flows that exist today, as definitions (ADR-0003): seeded into the database at start, once (an existing key is left
 * alone — the administration owns it afterwards), and the only fallback the public pages use when the database cannot be
 * reached. The Québec ruleset is data of the Sovkora pack `document-validation`; the French and Walloon ones are offered to
 * the landlord and the tenant alike.
 */
const COMPLIANCE = {
  id: "compliance",
  kind: "studio" as const,
  studio: "compliance-check" as const,
  pack: "document-validation",
  jurisdictions: [
    { code: "QC" as const, ruleset: "qc-residential-lease" },
    { code: "QC" as const, ruleset: "qc-visit-notice" },
    { code: "QC" as const, ruleset: "qc-premises-condition" },
    { code: "FR" as const, ruleset: "fr-residential-lease" },
    { code: "BE-WAL" as const, ruleset: "be-residential-lease" },
  ],
};
/** Québec's supplier invoice: a named ruleset of the same Studio (pack document-validation 1.3.0, rules from SOR/91-45 art. 3). */
const INVOICE = {
  id: "compliance",
  kind: "studio" as const,
  studio: "compliance-check" as const,
  pack: "document-validation",
  jurisdictions: [{ code: "QC" as const, ruleset: "qc-invoice" }],
};
/** The freelancer also has Québec's service contract (pack 1.4.0: federal law read at its source — the Civil Code rules are not encoded yet). */
const INVOICE_AND_CONTRACT = {
  ...INVOICE,
  jurisdictions: [
    { code: "QC" as const, ruleset: "qc-invoice" },
    { code: "QC" as const, ruleset: "qc-service-contract" },
  ],
};
const AUTHENTICITY = {
  id: "authenticity",
  kind: "studio" as const,
  studio: "document-authenticity" as const,
  pack: "document-validation",
  jurisdictions: [],
};

export interface SeedFlow {
  key: string;
  definition: FlowDefinition;
  environments: readonly FlowEnvironment[];
}

export const SEED_FLOWS: readonly SeedFlow[] = [
  {
    key: "lease-check-tenant",
    environments: ["dev", "prod"],
    definition: {
      title: { en: "Check your lease before you sign", fr: "Vérifiez votre bail avant de signer" },
      lead: {
        en: "Your lease against Québec's rules, line by line.",
        fr: "Votre bail au regard des règles du Québec, ligne par ligne.",
      },
      status: "available",
      audiences: ["tenant"],
      steps: [COMPLIANCE, AUTHENTICITY],
      consents: [],
      providers: [],
      pricing: { model: "free" },
    },
  },
  {
    key: "lease-check-landlord",
    environments: ["dev", "prod"],
    definition: {
      title: { en: "A compliant lease before you send it", fr: "Un bail conforme avant de l'envoyer" },
      lead: {
        en: "Your lease template against Québec's rules, and the tenant's papers examined.",
        fr: "Votre modèle de bail au regard des règles du Québec, et les pièces du locataire examinées.",
      },
      status: "available",
      audiences: ["landlord"],
      steps: [COMPLIANCE, AUTHENTICITY],
      consents: [],
      providers: [],
      pricing: { model: "free" },
    },
  },
  {
    key: "file-check-freelancer",
    environments: ["dev"],
    definition: {
      title: { en: "Invoices for freelancers", fr: "Factures pour travailleurs autonomes" },
      lead: {
        en: "Your invoice against Québec's mandatory mentions and the GST/QST number formats, and the PDF examined. Contract rules are coming.",
        fr: "Votre facture au regard des mentions obligatoires du Québec et du format des numéros de TPS et de TVQ, et le PDF examiné. Les règles des contrats arrivent.",
      },
      status: "available",
      audiences: ["freelancer"],
      steps: [INVOICE_AND_CONTRACT, AUTHENTICITY],
      consents: [],
      providers: [],
      pricing: { model: "free" },
    },
  },
  {
    key: "file-check-business",
    environments: ["dev"],
    definition: {
      title: { en: "Supplier invoices received", fr: "Factures de fournisseurs reçues" },
      lead: {
        en: "A supplier's invoice against Québec's mandatory mentions and the GST/QST number formats, and the PDF examined for edits. Supplier-contract rules are coming.",
        fr: "Une facture reçue au regard des mentions obligatoires du Québec et du format des numéros de TPS et de TVQ, et le PDF examiné. Les règles des contrats de fournisseurs arrivent.",
      },
      status: "available",
      audiences: ["business"],
      steps: [INVOICE, AUTHENTICITY],
      consents: [],
      providers: [],
      pricing: { model: "free" },
    },
  },
  {
    // Provider-agnostic until a contract exists: the demo provider returns fictitious data, dev only (docs/product/tenant-screening-research.md).
    key: "tenant-screening",
    environments: ["dev"],
    definition: {
      title: { en: "Check a tenant's application", fr: "Vérifier le dossier d'un locataire" },
      lead: {
        en: "With the tenant's consent: payment history only, the tenant sees the result first and can contest it.",
        fr: "Avec le consentement du locataire : l'historique de paiement seulement ; le locataire voit le résultat d'abord et peut le contester.",
      },
      status: "soon",
      audiences: ["landlord"],
      steps: [{ id: "provider-demo", kind: "provider", provider: "demo", jurisdictions: [] }],
      consents: ["screening-landlord-undertaking"],
      providers: ["demo"],
      pricing: { model: "free" },
    },
  },
];
