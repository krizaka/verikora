import type { DocumentTypeDef, IdentifierDef } from "./port";

/**
 * The types of documents Verikora recognises, and the identifiers it reads — DATA. A new nature is a new entry (and, if a rules
 * pack fits, its `check`), not a new code path. `check: null` means no legal check applies: the page says so plainly.
 */
export const DOCUMENT_TYPES: readonly DocumentTypeDef[] = [
  {
    id: "revenu-quebec-registration",
    label: { fr: "Reçu d’inscription — Revenu Québec", en: "Registration receipt — Revenu Québec" },
    signals: [
      { pattern: String.raw`revenu\s+qu[ée]bec`, weight: 4 },
      { pattern: String.raw`inscription\s+d['’]une\s+entreprise`, weight: 5 },
      { pattern: String.raw`entreprise\s+en\s+d[ée]marrage`, weight: 3 },
      { pattern: String.raw`\bNEQ\b|num[ée]ro\s+d['’]entreprise\s+du\s+qu[ée]bec`, weight: 3 },
      { pattern: String.raw`accus[ée]\s+de\s+r[ée]ception|\bre[çc]u\b`, weight: 1 },
    ],
    issuer: "Revenu Québec",
    check: null,
    authenticity: true,
  },
  {
    id: "invoice",
    label: { fr: "Facture", en: "Invoice" },
    signals: [
      { pattern: String.raw`\bfacture\b|\binvoice\b`, weight: 4 },
      { pattern: String.raw`\bTPS\b|\bGST\b`, weight: 2 },
      { pattern: String.raw`\bTVQ\b|\bQST\b`, weight: 2 },
      { pattern: "sous-?total|sub-?total", weight: 1 },
      { pattern: String.raw`total\s+(?:d[ûu]|à\s+payer|due|amount\s+due)`, weight: 2 },
      { pattern: String.raw`conditions?\s+de\s+paiement|payment\s+terms`, weight: 1 },
      { pattern: String.raw`n[°o]\.?\s*(?:de\s+)?facture|invoice\s*(?:no\.?|number|#)`, weight: 2 },
    ],
    issuerPatterns: [
      String.raw`(?:[ée]metteur|fournisseur|vendeur|issued\s+by|supplier)\s*(?:/\s*[A-Za-z ]+)?\s*:\s*\n?\s*([^\n,/]{3,80})`,
    ],
    check: { studio: "compliance-check", documentType: "invoice", ruleset: "qc-invoice" },
  },
  {
    id: "residential-lease",
    label: { fr: "Bail de logement", en: "Residential lease" },
    signals: [
      { pattern: String.raw`bail\s+de\s+logement|residential\s+lease|mod[èe]le\s+de\s+bail`, weight: 5 },
      { pattern: String.raw`\bbail\b`, weight: 2 },
      { pattern: "locateur|locatrice|landlord", weight: 2 },
      { pattern: String.raw`locataire|\btenant\b`, weight: 2 },
      { pattern: String.raw`\bloyer\b|\brent\b`, weight: 1 },
      { pattern: String.raw`tribunal\s+administratif\s+du\s+logement|\bTAL\b`, weight: 3 },
    ],
    check: { studio: "compliance-check", documentType: "lease", ruleset: null },
  },
  {
    id: "service-contract",
    label: { fr: "Contrat de services", en: "Service contract" },
    signals: [
      { pattern: String.raw`contrat\s+de\s+(?:services?|prestation)|services?\s+agreement`, weight: 5 },
      { pattern: String.raw`prestataire|contractor|service\s+provider`, weight: 2 },
      { pattern: String.raw`\bclient\b`, weight: 1 },
      { pattern: String.raw`droits?\s+d['’]auteur|copyright`, weight: 1 },
      { pattern: "r[ée]siliation|termination", weight: 1 },
    ],
    check: { studio: "compliance-check", documentType: "contract", ruleset: "qc-service-contract" },
  },
  {
    id: "pay-stub",
    label: { fr: "Talon de paie", en: "Pay stub" },
    signals: [
      {
        pattern: String.raw`talon\s+de\s+paie|bulletin\s+de\s+paie|relev[ée]\s+de\s+paie|pay\s*stub|payslip`,
        weight: 5,
      },
      { pattern: String.raw`salaire\s+(?:brut|net)|gross\s+pay|net\s+pay`, weight: 2 },
      { pattern: String.raw`\bRRQ\b|\bQPP\b|assurance[- ]emploi|\bCPP\b`, weight: 2 },
      { pattern: "employeur|employer", weight: 1 },
    ],
    check: null,
    authenticity: true,
  },
  {
    id: "bank-statement",
    label: { fr: "Relevé de compte bancaire", en: "Bank statement" },
    signals: [
      { pattern: String.raw`relev[ée]\s+de\s+compte|bank\s+statement|account\s+statement`, weight: 5 },
      {
        pattern: String.raw`solde\s+(?:d['’]ouverture|de\s+cl[ôo]ture|final)|opening\s+balance|closing\s+balance`,
        weight: 3,
      },
      { pattern: String.raw`\btransit\b|\binstitution\b|\bIBAN\b`, weight: 1 },
      { pattern: "d[ée]p[ôo]t|retrait|withdrawal", weight: 1 },
    ],
    check: null,
    authenticity: true,
  },
  {
    id: "identity-document",
    label: { fr: "Pièce d’identité", en: "Identity document" },
    signals: [
      {
        pattern: String.raw`permis\s+de\s+conduire|driver['’]s\s+licen[cs]e|carte\s+d['’]assurance\s+maladie|passeport|passport|carte\s+d['’]identit[ée]|identity\s+card`,
        weight: 5,
      },
      { pattern: String.raw`date\s+de\s+naissance|date\s+of\s+birth`, weight: 2 },
    ],
    check: null,
    authenticity: true,
  },
  {
    id: "visit-notice",
    label: { fr: "Avis de visite du logement", en: "Notice of a visit to the dwelling" },
    signals: [
      { pattern: String.raw`avis\s+de\s+visite|visit\s+notice|notice\s+of\s+(?:a\s+)?visit`, weight: 5 },
      { pattern: String.raw`visite\s+du\s+logement|visite\s+des\s+lieux|dwelling\s+visit`, weight: 2 },
      { pattern: String.raw`pr[ée]avis\s+de\s+(?:24|vingt-quatre)\s+heures|24\s+hours?\s+notice`, weight: 2 },
      { pattern: "locateur|locatrice|landlord", weight: 1 },
      { pattern: String.raw`locataire|\btenant\b`, weight: 1 },
    ],
    check: { studio: "compliance-check", documentType: "visit-notice", ruleset: "qc-visit-notice" },
  },
  {
    id: "premises-condition",
    label: { fr: "État des lieux", en: "Condition report of the premises" },
    signals: [
      { pattern: String.raw`[ée]tat\s+des\s+lieux|condition\s+report|move[- ]in\s+inspection`, weight: 5 },
      {
        pattern: String.raw`constat\s+d['’][ée]tat|[ée]tat\s+du\s+logement|condition\s+of\s+the\s+(?:dwelling|premises)`,
        weight: 3,
      },
      { pattern: String.raw`entr[ée]e\s+en\s+jouissance|move[- ]in`, weight: 2 },
      { pattern: String.raw`bon\s+[ée]tat|mauvais\s+[ée]tat|good\s+condition|damaged`, weight: 1 },
    ],
    check: { studio: "compliance-check", documentType: "premises-condition", ruleset: "qc-premises-condition" },
  },
];

/** Identifiers read from the text (group 1 is the value). */
export const IDENTIFIERS: readonly IdentifierDef[] = [
  {
    kind: "neq",
    label: { fr: "NEQ", en: "NEQ" },
    pattern: String.raw`(?:\bNEQ\b|num[ée]ro\s+d['’]entreprise\s+du\s+qu[ée]bec)\D{0,25}(\d{10})\b`,
  },
  { kind: "gst", label: { fr: "N° de TPS", en: "GST no." }, pattern: String.raw`(\b\d{9}\s?RT\s?\d{4}\b)` },
  { kind: "qst", label: { fr: "N° de TVQ", en: "QST no." }, pattern: String.raw`(\b\d{10}\s?TQ\s?\d{4}\b)` },
  {
    kind: "invoice-number",
    label: { fr: "N° de facture", en: "Invoice no." },
    pattern: String.raw`(?:n[°o]\.?\s*(?:de\s+)?facture|facture\s*(?:n[°o]\.?|#)|invoice\s*(?:no\.?|number|#))\s*:?\s*([A-Z0-9][A-Z0-9-]{2,})`,
  },
  {
    kind: "reference",
    label: { fr: "N° de référence", en: "Reference no." },
    pattern: String.raw`(?:n[°o]\.?\s*de\s+r[ée]f[ée]rence|r[ée]f[ée]rence\s*(?:n[°o]\.?)?|reference\s*(?:no\.?|number|#))\s*:?\s*([A-Z0-9][A-Z0-9-]{4,})`,
  },
];

/** Roles of the parties a document names (`Role : Name`). */
export const PARTY_ROLES: readonly { role: string; pattern: string }[] = [
  { role: "landlord", pattern: "locateur|locatrice|landlord" },
  { role: "tenant", pattern: "locataire|tenant" },
  { role: "contractor", pattern: String.raw`prestataire|contractor|service\s+provider` },
  { role: "client", pattern: "client" },
  { role: "employer", pattern: "employeur|employer" },
  { role: "employee", pattern: "employ[ée]e?|employee" },
  { role: "company", pattern: String.raw`nom\s+de\s+l['’]entreprise|raison\s+sociale|entreprise|company` },
  { role: "supplier", pattern: "fournisseur|vendeur|supplier" },
  { role: "buyer", pattern: String.raw`acheteur|factur[ée]\s+à|bill\s+to|buyer` },
  { role: "holder", pattern: String.raw`titulaire|account\s+holder` },
];
