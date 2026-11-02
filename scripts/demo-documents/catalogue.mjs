// The fictitious Québec documents of the demo, as data: who, what, what is wrong with it and what a check is expected to find.
// Everything is invented. Names are made up; a postal code uses a letter (D) that Canada Post never issues, so no address can
// exist; a SIN-like number starts with 0, which a real SIN never does; companies carry « fictif » or an obviously made-up name.
import { hashSeed, seededRandom } from "./random.mjs";

export const DEFAULT_SEED = 20261023;
export const AS_OF = "2026-10-23";

const FIRST = ["Camille", "Mathis", "Léa", "Nathan", "Élodie", "Samuel", "Maude", "Olivier", "Rosalie", "Thierry"];
const LAST = [
  "Fictif-Beaulieu",
  "Imaginaire-Roy",
  "Exemple-Lavoie",
  "Inventé-Gagné",
  "Factice-Morin",
  "Modèle-Bergeron",
  "Simulé-Pelletier",
  "Fictif-Caron",
];
const STREETS = [
  "rue des Fictifs",
  "avenue de l'Exemple",
  "boulevard Imaginaire",
  "rue du Modèle",
  "chemin des Inventés",
];
const EMPLOYERS = [
  "Boulangerie Imaginaire ltée",
  "Atelier Factice inc.",
  "Services Exemple (fictif) inc.",
  "Café Inventé s.e.n.c.",
];

const money = (cents) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${whole},${String(abs % 100).padStart(2, "0")} $`;
};

function person(rng) {
  return `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
}
function address(rng) {
  return `${rng.int(100, 4999)}, ${rng.pick(STREETS)}, Montréal (Québec) H${rng.int(1, 9)}D ${rng.int(1, 9)}D${rng.int(1, 9)}`;
}
function sinLike(rng) {
  return `0${rng.int(10, 99)} ${rng.int(100, 999)} ${rng.int(100, 999)}`;
}
const banner = (what) => [
  `DOCUMENT FICTIF — ${what}`,
  "Jeu de données de démonstration Verikora : personnes, adresses et montants inventés.",
  "",
];

function lease(rng, flaw) {
  const landlord = person(rng);
  const tenant = person(rng);
  const rent = rng.int(9, 19) * 100 + rng.pick([0, 25, 50]);
  // The lease with no TAL notice also carries a lowest rent well under the new one (Section G, yomizaka#104): the increase is over the TAL's rate.
  const lowest = flaw === "no-tal" ? rent - 90 : rent - 25;
  const lines = [
    ...banner("bail de logement"),
    "BAIL DE LOGEMENT",
    `Logement : ${address(rng)}`,
    `Locateur : ${landlord} (fictif), domicilié au ${address(rng)}`,
    `Locataire : ${tenant} (fictif), domicilié à Montréal.`,
    "Durée : 12 mois, du 1er juillet 2026 au 30 juin 2027.",
    `Loyer mensuel : ${money(rent * 100)}, payable le premier jour du mois.`,
    // The mandatory notice of the lowest rent of the last twelve months (the form's section G): a lease without it is not clean.
    `Le loyer le plus bas payé au cours des douze derniers mois précédant le début du bail était de ${money(lowest * 100)} par mois.`,
    "Le loyer comprend le chauffage et l'eau chaude.",
    "Le locataire a droit au maintien dans les lieux à la fin du bail.",
    "Le locateur peut proposer une hausse de loyer selon les règles du Tribunal administratif du logement.",
    // The mandatory form (C.c.Q. art. 1895, QC-LEASE-014): a lease that does not say it is on the TAL form is not clean.
    "Le présent bail est établi sur le formulaire obligatoire du Tribunal administratif du logement (TAL), qui est joint au bail.",
    "",
  ];
  const findings = [];
  if (flaw !== "no-tal")
    lines.push(
      "Le locateur remet au locataire l'avis « Renseignements au nouveau locataire d'un logement » du Tribunal administratif du logement (TAL).",
    );
  else {
    findings.push({
      code: "QC-LEASE-TAL-NOTICE",
      title: "Avis du TAL non remis",
      severity: "BLOCKING",
      explanation:
        "Le bail ne mentionne pas la remise de l'avis « Renseignements au nouveau locataire d'un logement » du Tribunal administratif du logement.",
      absent: ["Renseignements au nouveau locataire"],
    });
  }
  if (flaw === "illegal-clause") {
    const clauseA = "Il est interdit d'avoir des enfants dans le logement.";
    const clauseB = `Le locataire verse un dépôt de sécurité de ${money(rent * 100)} à la signature.`;
    lines.push(clauseA, clauseB, "Le locataire remet douze chèques postdatés.");
    findings.push({
      code: "QC-LEASE-ILLEGAL-CLAUSE",
      title: "Clause illégale",
      severity: "BLOCKING",
      explanation:
        "Interdire les enfants, exiger un dépôt de sécurité et des chèques postdatés sont des clauses que le Code civil du Québec interdit (art. 1899 et 1904).",
      present: [clauseA, "dépôt de sécurité", "chèques postdatés"],
    });
  }
  lines.push("", `Signé à Montréal le 15 juin 2026 : ${landlord} (fictif) et ${tenant} (fictif).`);
  // The figures the lease states, in the shape the engine's report gives them (`facts`): what the tenant-shield rules read, true to the text above.
  const facts = {
    rentCents: { status: "found", cents: rent * 100 },
    lowestRentCents: { status: "found", cents: lowest * 100 },
    concludedOn: { status: "found", date: "2026-06-15" },
    startsOn: { status: "found", date: "2026-07-01" },
    noticeGiven: { status: "found", flag: flaw !== "no-tal" },
    ...(flaw === "illegal-clause"
      ? { depositCents: { status: "found", cents: rent * 100 }, postdatedCheques: { status: "found", flag: true } }
      : {}),
  };
  return { lines, findings, facts };
}

function payStub(rng, flaw) {
  const employer = rng.pick(EMPLOYERS);
  const employee = person(rng);
  const gross = rng.int(18, 34) * 10000 + rng.pick([0, 5000]);
  const deductions = [
    ["Impôt fédéral", Math.round(gross * 0.11)],
    ["Impôt du Québec", Math.round(gross * 0.09)],
    ["Régime de rentes du Québec", Math.round(gross * 0.063)],
    ["Assurance-emploi", Math.round(gross * 0.0131)],
    ["Régime québécois d'assurance parentale", Math.round(gross * 0.0043)],
  ];
  const total = deductions.reduce((sum, [, cents]) => sum + cents, 0);
  const net = gross - total;
  const printedNet = flaw === "bad-totals" ? net + 12500 : net;
  const lines = [
    ...banner("relevé de paie"),
    "RELEVÉ DE PAIE",
    `Employeur : ${employer}`,
    `Employé : ${employee} (fictif)`,
    `NAS : ${sinLike(rng)} (numéro fictif, invalide)`,
    "Période de paie : du 1er au 15 octobre 2026",
    "",
    `Salaire brut : ${money(gross)}`,
    ...deductions.map(([label, cents]) => `${label} : ${money(cents)}`),
    `Total des retenues : ${money(total)}`,
    `Net à payer : ${money(printedNet)}`,
  ];
  const findings =
    flaw === "bad-totals"
      ? [
          {
            code: "PAYSTUB-TOTALS-MISMATCH",
            title: "Les totaux ne concordent pas",
            severity: "BLOCKING",
            explanation: `Le salaire brut moins les retenues donne ${money(net)}, mais le relevé indique ${money(printedNet)}.`,
            present: [`Net à payer : ${money(printedNet)}`, `Total des retenues : ${money(total)}`],
          },
        ]
      : [];
  return { lines, findings };
}

function bankStatement(rng, flaw) {
  const holder = person(rng);
  const opening = rng.int(8, 40) * 10000;
  const moves = [
    ["Dépôt — paie Atelier Factice inc.", rng.int(12, 24) * 10000],
    ["Loyer — Gestion Exemple (fictif)", -rng.int(9, 17) * 10000],
    ["Épicerie fictive du coin", -rng.int(80, 190) * 100],
    ["Électricité (fournisseur fictif)", -rng.int(60, 140) * 100],
    ["Remboursement entre amis", rng.int(20, 60) * 100],
    ["Abonnement fictif", -rng.int(10, 30) * 100],
  ];
  const lines = [
    ...banner("relevé bancaire"),
    "RELEVÉ DE COMPTE",
    "Banque Imaginaire du Québec (fictive)",
    `Titulaire : ${holder} (fictif)`,
    "Période : du 1er au 30 septembre 2026",
    "",
    `Solde d'ouverture : ${money(opening)}`,
  ];
  let balance = opening;
  for (const [label, cents] of moves) {
    balance += cents;
    lines.push(`${label} : ${money(cents)} — solde ${money(balance)}`);
  }
  const printed = flaw === "edited-balance" ? balance + rng.int(15, 40) * 10000 : balance;
  lines.push(`Solde de clôture : ${money(printed)}`);
  const findings =
    flaw === "edited-balance"
      ? [
          {
            code: "BANK-BALANCE-EDITED",
            title: "Solde de clôture modifié",
            severity: "BLOCKING",
            explanation: `Les mouvements mènent à ${money(balance)}, mais le solde de clôture indique ${money(printed)}.`,
            present: [`Solde de clôture : ${money(printed)}`, `Solde d'ouverture : ${money(opening)}`],
          },
        ]
      : [];
  return { lines, findings };
}

function employmentLetter(rng, flaw) {
  const employer = rng.pick(EMPLOYERS);
  const employee = person(rng);
  const expired = flaw === "expired";
  const validity = expired ? "31 mars 2025" : "15 mars 2027";
  const lines = [
    ...banner("lettre d'emploi"),
    employer,
    expired ? "Montréal, le 15 septembre 2024" : "Montréal, le 15 septembre 2026",
    "",
    "LETTRE D'EMPLOI",
    `Nous confirmons que ${employee} (fictif) occupe un poste permanent à temps plein dans notre entreprise.`,
    `Salaire annuel : ${money(rng.int(38, 78) * 100000)}.`,
    `La présente lettre est valide jusqu'au ${validity}.`,
    "",
    "Signé : Direction des ressources humaines (fictive)",
  ];
  const findings = expired
    ? [
        {
          code: "DOCUMENT-EXPIRED",
          title: "Document expiré",
          severity: "BLOCKING",
          explanation: `La lettre était valide jusqu'au 31 mars 2025, avant la date de vérification (${AS_OF}).`,
          present: ["valide jusqu'au 31 mars 2025"],
        },
      ]
    : [];
  return { lines, findings };
}

function invoice(rng, flaw, number) {
  const supplier = rng.pick(EMPLOYERS);
  const items = [
    ["Entretien du hall et des escaliers", rng.int(8, 20) * 10000],
    ["Déneigement (forfait)", rng.int(5, 12) * 10000],
    ["Réparation de la porte arrière", rng.int(2, 6) * 10000],
  ];
  const subtotal = items.reduce((sum, [, cents]) => sum + cents, 0);
  const tps = Math.round(subtotal * 0.05);
  const tvq = Math.round(subtotal * 0.09975);
  const total = subtotal + tps + tvq;
  const printed = flaw === "bad-totals" ? total + 10000 : total;
  const lines = [
    ...banner("facture"),
    `FACTURE ${number}`,
    `Fournisseur : ${supplier}`,
    "Client : Gestion Rosemont Fictive inc.",
    `Date : ${number}-15`,
    "",
    ...items.map(([label, cents]) => `${label} : ${money(cents)}`),
    `Sous-total : ${money(subtotal)}`,
    `TPS (5 %) : ${money(tps)}`,
    `TVQ (9,975 %) : ${money(tvq)}`,
    `Total à payer : ${money(printed)}`,
  ];
  const findings =
    flaw === "bad-totals"
      ? [
          {
            code: "INVOICE-TOTAL-MISMATCH",
            title: "Le total ne concorde pas",
            severity: "BLOCKING",
            explanation: `Le sous-total et les taxes donnent ${money(total)}, mais la facture indique ${money(printed)}.`,
            present: [`Total à payer : ${money(printed)}`],
          },
        ]
      : [];
  return { lines, findings };
}

function contract(rng) {
  const lines = [
    ...banner("contrat d'entretien"),
    "CONTRAT D'ENTRETIEN D'IMMEUBLE",
    "Entre Gestion Rosemont Fictive inc. (le client) et Atelier Factice inc. (le prestataire).",
    "1. Le prestataire entretient les aires communes de l'immeuble deux fois par semaine.",
    `2. Le client verse ${money(rng.int(8, 15) * 10000)} par mois, taxes en sus.`,
    "3. Le contrat dure 12 mois à compter du 1er janvier 2026 et se renouvelle d'un commun accord.",
    "4. Chaque partie peut y mettre fin avec un préavis écrit de 60 jours.",
    "",
    "Signé à Montréal : le client et le prestataire (fictifs).",
  ];
  return { lines, findings: [] };
}

/** Every document of the demo: id, kind in Yomizaka, family (what it is), flaw (null = clean) and the builder. */
export const SPECS = [
  {
    id: "bail-rosemont-1-conforme",
    family: "lease",
    kind: "lease",
    flaw: null,
    title: "Bail — Rosemont, logement 1 (conforme)",
  },
  {
    id: "bail-rosemont-2-conforme",
    family: "lease",
    kind: "lease",
    flaw: null,
    title: "Bail — Rosemont, logement 2 (conforme)",
  },
  {
    id: "bail-rosemont-3-conforme",
    family: "lease",
    kind: "lease",
    flaw: null,
    title: "Bail — Rosemont, logement 3 (conforme)",
  },
  {
    id: "bail-rosemont-4-sans-avis-tal",
    family: "lease",
    kind: "lease",
    flaw: "no-tal",
    title: "Bail — Rosemont, logement 4 (avis du TAL absent)",
  },
  {
    id: "bail-rosemont-5-clause-illegale",
    family: "lease",
    kind: "lease",
    flaw: "illegal-clause",
    title: "Bail — Rosemont, logement 5 (clause illégale)",
  },
  {
    id: "contrat-entretien-rosemont",
    family: "contract",
    kind: "contract",
    flaw: null,
    title: "Contrat d'entretien — Rosemont",
  },
  {
    id: "paie-villeray-1-conforme",
    family: "pay-stub",
    kind: "other",
    flaw: null,
    title: "Relevé de paie — candidat 1",
  },
  {
    id: "paie-villeray-2-totaux-faux",
    family: "pay-stub",
    kind: "other",
    flaw: "bad-totals",
    title: "Relevé de paie — candidat 2 (totaux inexacts)",
  },
  {
    id: "banque-villeray-1-conforme",
    family: "bank-statement",
    kind: "other",
    flaw: null,
    title: "Relevé bancaire — candidat 1",
  },
  {
    id: "banque-villeray-2-solde-modifie",
    family: "bank-statement",
    kind: "other",
    flaw: "edited-balance",
    title: "Relevé bancaire — candidat 2 (solde modifié)",
  },
  {
    id: "emploi-villeray-1-conforme",
    family: "employment-letter",
    kind: "other",
    flaw: null,
    title: "Lettre d'emploi — candidat 1",
  },
  {
    id: "emploi-villeray-2-expiree",
    family: "employment-letter",
    kind: "other",
    flaw: "expired",
    title: "Lettre d'emploi — candidat 2 (expirée)",
  },
  { id: "facture-2026-01", family: "invoice", kind: "invoice", flaw: null, title: "Facture 2026-01 — entretien" },
  { id: "facture-2026-02", family: "invoice", kind: "invoice", flaw: null, title: "Facture 2026-02 — entretien" },
  { id: "facture-2026-03", family: "invoice", kind: "invoice", flaw: null, title: "Facture 2026-03 — entretien" },
  {
    id: "facture-2026-04-total-faux",
    family: "invoice",
    kind: "invoice",
    flaw: "bad-totals",
    title: "Facture 2026-04 — total inexact",
  },
];

const BUILDERS = {
  lease: (rng, spec) => lease(rng, spec.flaw),
  "pay-stub": (rng, spec) => payStub(rng, spec.flaw),
  "bank-statement": (rng, spec) => bankStatement(rng, spec.flaw),
  "employment-letter": (rng, spec) => employmentLetter(rng, spec.flaw),
  invoice: (rng, spec) => invoice(rng, spec.flaw, `2026-${spec.id.match(/2026-(\d\d)/)?.[1] ?? "01"}`),
  contract: (rng) => contract(rng),
};

/** One document's text and expected findings, the same for the same seed. */
export function buildDocument(spec, seed = DEFAULT_SEED) {
  const { lines, findings, facts } = BUILDERS[spec.family](seededRandom(hashSeed(`${seed}:${spec.id}`)), spec);
  return { ...spec, filename: `${spec.id}.pdf`, lines, findings, ...(facts ? { facts } : {}) };
}

/** The persona Éric (property manager): his display name, his collections and the documents each one holds. */
export const PERSONA_ERIC = {
  key: "eric",
  // The display name comes from the cast (`@krizaka/org`, persona `eric`): one source for the seed, the QA accounts and the recordings.
  collections: [
    { key: "rosemont", documents: SPECS.filter((s) => /rosemont/.test(s.id)).map((s) => s.id) },
    { key: "villeray", documents: SPECS.filter((s) => /villeray/.test(s.id)).map((s) => s.id) },
    { key: "invoices", documents: SPECS.filter((s) => /^facture-2026/.test(s.id)).map((s) => s.id) },
    // Two folders with nothing in them (and the default one stays empty): the empty state of the open folder's card is rendered and audited (yomizaka#435).
    { key: "empty-a", documents: [] },
    { key: "empty-b", documents: [] },
  ],
  /** The documents that carry a finished check (seeded, marked as such). */
  checked: [
    "bail-rosemont-1-conforme",
    "bail-rosemont-4-sans-avis-tal",
    "bail-rosemont-5-clause-illegale",
    "paie-villeray-2-totaux-faux",
    "banque-villeray-2-solde-modifie",
    "emploi-villeray-2-expiree",
    "facture-2026-04-total-faux",
  ],
  /**
   * The checks that did not finish, one per real cause (krizaka-internal#1936): the error is the sentence the app stores, which a
   * person never reads — `lib/check-failure` turns it into plain words. Idempotent like the rest of the seed.
   */
  failed: [
    {
      id: "bail-rosemont-2-conforme",
      studio: "compliance-check",
      error: "Orazaka finished without a report Yomizaka can read",
    },
    { id: "bail-rosemont-3-conforme", studio: "compliance-check", error: "The run ended failed" },
    {
      id: "contrat-entretien-rosemont",
      studio: "document-authenticity",
      error: "Orazaka refused the document as sent",
    },
  ],
};
