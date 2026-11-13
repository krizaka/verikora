// The sample applicant file (krizaka-internal#3119): one fictitious applicant, four documents that agree with each other
// (the employer, the pay, the rent). Everything is invented: surnames carry a marker word, a postal code uses the letter D (Canada
// Post never issues it), the SIN-like number starts with 0, the bank and the employer are made up. Pure data: build.mjs writes the PDFs.
export const APPLICANT = "Rosalie Modèle-Bergeron";
export const LANDLORD = "Camille Exemple-Lavoie";
export const EMPLOYER = "Atelier Factice inc.";
export const AS_OF = "2026-11-13";

const header = (what) => [
  `DOCUMENT FICTIF — ${what}`,
  "Dossier de démonstration Verikora : personnes, adresses et montants inventés.",
  "",
];

/** The lease the applicant is offered: two clauses the Civil Code forbids (a security deposit, post-dated cheques), so the check has something to find. */
const lease = [
  ...header("bail de logement"),
  "BAIL DE LOGEMENT",
  "Logement : 4½, 218, rue des Fictifs, Montréal (Québec) H2D 3D4",
  `Locateur : ${LANDLORD} (fictif), domicilié au 77, avenue de l'Exemple, Montréal (Québec) H2D 1D5`,
  `Locataire : ${APPLICANT} (fictif), domiciliée à Montréal.`,
  "Durée : 12 mois, du 1er janvier 2027 au 31 décembre 2027.",
  "Loyer mensuel : 1 100,00 $, payable le premier jour du mois.",
  "Le loyer le plus bas payé au cours des douze derniers mois précédant le début du bail était de 1 080,00 $ par mois.",
  "Le loyer ne comprend ni le chauffage ni l'électricité.",
  "Le locataire a droit au maintien dans les lieux à la fin du bail.",
  "Le présent bail est établi sur le formulaire obligatoire du Tribunal administratif du logement.",
  "Le locateur remet au locataire l'avis « Renseignements au nouveau locataire d'un logement » du Tribunal administratif du logement.",
  "Le locataire verse un dépôt de sécurité de 1 100,00 $ à la signature.",
  "Le locataire remet douze chèques postdatés.",
  "",
  "Signé à Montréal par les parties (fictives).",
];

const payStub = [
  ...header("relevé de paie"),
  "RELEVÉ DE PAIE",
  `Employeur : ${EMPLOYER}`,
  `Employée : ${APPLICANT} (fictif)`,
  "NAS : 062 975 759 (numéro fictif, invalide)",
  "Période de paie : du 1er au 15 octobre 2026",
  "",
  "Salaire brut : 3 100,00 $",
  "Impôt fédéral : 341,00 $",
  "Impôt du Québec : 279,00 $",
  "Régime de rentes du Québec : 195,30 $",
  "Assurance-emploi : 40,61 $",
  "Régime québécois d'assurance parentale : 13,33 $",
  "Total des retenues : 869,24 $",
  "Net à payer : 2 230,76 $",
];

const bank = [
  ...header("relevé bancaire"),
  "RELEVÉ DE COMPTE",
  "Banque Imaginaire du Québec (fictive)",
  `Titulaire : ${APPLICANT} (fictif)`,
  "Période : du 1er au 31 octobre 2026",
  "",
  "Solde d'ouverture : 1 400,00 $",
  `Dépôt — paie ${EMPLOYER} : 2 230,76 $ — solde 3 630,76 $`,
  "Loyer — Gestion Exemple (fictif) : -1 080,00 $ — solde 2 550,76 $",
  "Épicerie fictive du coin : -97,00 $ — solde 2 453,76 $",
  "Électricité (fournisseur fictif) : -115,00 $ — solde 2 338,76 $",
  `Dépôt — paie ${EMPLOYER} : 2 230,76 $ — solde 4 569,52 $`,
  "Abonnement fictif : -24,00 $ — solde 4 545,52 $",
  "Solde de clôture : 4 545,52 $",
];

const employment = [
  ...header("lettre d'emploi"),
  EMPLOYER,
  "Montréal, le 1er novembre 2026",
  "",
  "LETTRE D'EMPLOI",
  `Nous confirmons que ${APPLICANT} (fictif) occupe un poste permanent à temps plein dans notre entreprise.`,
  "Salaire annuel : 74 400,00 $.",
  "La présente lettre est valide jusqu'au 1er mai 2027.",
  "",
  "Signé : Direction des ressources humaines (fictive)",
];

/** The documents in the order a manager reads them. `made` says how each one was made (provenance.json). */
export const DOCUMENTS = [
  {
    id: "bail",
    filename: "bail-4-et-demi-rue-des-fictifs.pdf",
    title: "Bail — 4½, rue des Fictifs",
    lines: lease,
    checked: "compliance-check",
  },
  {
    id: "paie",
    filename: "releve-de-paie-octobre-2026.pdf",
    title: "Relevé de paie — octobre 2026",
    lines: payStub,
    checked: null,
  },
  {
    id: "banque",
    filename: "releve-bancaire-octobre-2026.pdf",
    title: "Relevé bancaire — octobre 2026",
    lines: bank,
    checked: null,
  },
  { id: "emploi", filename: "lettre-d-emploi.pdf", title: "Lettre d'emploi", lines: employment, checked: null },
];
