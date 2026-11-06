import { ANSWER, type BusinessRegistry, NOT_LOOKED_UP, type NotLookedUpReason } from "./model";
import { checkIssuer, type PrintedIssuer, registrantOfNeq, type RegistrySignal } from "./signals";

/*
 * What the document report says of the registers (verikora#627): the number printed on the document, read against the public registers,
 * as questions to ask the issuer — never a verdict. A register that did not answer is said as « not looked up », with its reason.
 */

/** Revenu Québec's validation API, named in the source line of the report. */
export const QST_API = "SW-340";

/** What the document's understanding gives the report: the issuer, the numbers printed, the dates. */
export interface PrintedFacts {
  issuer: string | null;
  references: readonly { kind: string; value: string }[];
  dates: readonly { kind: string; value: string }[];
}

export interface RegistryReport {
  /** The register's name and API, e.g. « Revenu Québec (SW-340) ». */
  source: string;
  /** When the register was consulted (ISO). */
  consultedAt: string;
  /** The QST number as printed. */
  number: string;
  qst: { looked: boolean; reason: NotLookedUpReason | null; signals: RegistrySignal[] };
  /** The registers that are not used: said as « not looked up », never silently skipped. */
  gstHst: NotLookedUpReason;
  neq: NotLookedUpReason;
}

/** The kinds the understanding gives: the identifiers it reads (`IDENTIFIERS`) and the dates it dates (`DateFact`). */
const KIND = { qst: "qst", neq: "neq", issued: "issued" } as const;

const referenceOf = (facts: PrintedFacts, kind: string): string | null =>
  facts.references.find((r) => r.kind === kind)?.value ?? null;

/** Why a register that is not used was not looked up (it answers « not looked up » and nothing else). */
async function reasonOf(registry: BusinessRegistry, number: string): Promise<NotLookedUpReason> {
  const answer = await registry.lookupQst(number);
  return answer.kind === ANSWER.notLookedUp ? answer.reason : NOT_LOOKED_UP.notCovered;
}

/** The registry part of a document's report, or null when the document carries no QST number (nothing is looked up). */
export async function registryReport(
  facts: PrintedFacts,
  registries: { qst: BusinessRegistry; gstHst: BusinessRegistry; req: BusinessRegistry },
  now: Date,
): Promise<RegistryReport | null> {
  const number = referenceOf(facts, KIND.qst);
  if (!number) {
    return null;
  }
  const issuer: PrintedIssuer = {
    number,
    name: facts.issuer,
    registrant: registrantOfNeq(referenceOf(facts, KIND.neq)),
    documentDate: facts.dates.find((d) => d.kind === KIND.issued)?.value ?? null,
  };
  const checked = await checkIssuer(registries.qst, issuer);
  return {
    source: `${registries.qst.source} (${QST_API})`,
    consultedAt: now.toISOString(),
    number,
    qst: {
      looked: checked.looked,
      reason: checked.reason,
      signals: checked.signals,
    },
    gstHst: await reasonOf(registries.gstHst, number),
    neq: await reasonOf(registries.req, number),
  };
}
