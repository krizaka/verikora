import type { Signal } from "@verikora/core";

import { ANSWER, type BusinessRegistry, FOUND_STATUS, type NotLookedUpReason, type RegistryAnswer } from "./model";

/*
 * The registry signals REG-001…003 (ADR-0014): a question to ask the issuer, never a verdict. They are `inhabituel`, never `incohérent`
 * (only arithmetic on a document's own figures is). A register that did not answer raises nothing.
 */
export interface PrintedIssuer {
  /** The QST number as printed. */
  number: string;
  /** The issuer's name as printed, when read. */
  name?: string | null;
  /** "business" when the registrant is a legal person or partnership (NEQ prefix 11 or 33); "individual" for a sole proprietorship (22); "unknown" otherwise. */
  registrant: "business" | "individual" | "unknown";
  /** The document's date (YYYY-MM-DD). */
  documentDate?: string | null;
}

/** The NEQ prefix tells who registered: 11 legal person, 22 sole proprietorship, 33 partnership or group. */
export function registrantOfNeq(neq: string | null | undefined): PrintedIssuer["registrant"] {
  const prefix = (neq ?? "").replaceAll(/\D/g, "").slice(0, 2);
  if (prefix === "22") {
    return "individual";
  }
  return prefix === "11" || prefix === "33" ? "business" : "unknown";
}

const LEGAL_FORMS = new Set(["inc", "ltee", "ltd", "enr", "senc", "sencrl", "cie", "co", "corp", "limitee"]);
/** A name reduced for comparison: lower case, no accents or punctuation, no legal form. */
export function comparableName(name: string): string {
  return name
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !LEGAL_FORMS.has(w))
    .join(" ");
}

const sameName = (a: string, b: string): boolean => {
  const [x, y] = [comparableName(a), comparableName(b)];
  return x === y || (x.length > 3 && y.includes(x)) || (y.length > 3 && x.includes(y));
};

/** A registry signal: the English text of `Signal` (API, PDF) plus the values the interface puts into its own EN/FR messages (`console.analysis.registry.signals.<id>`). */
export type RegistrySignal = Signal & { vars: Readonly<Record<string, string>> };

const base = { family: "figures", evidence: { field: "issuer QST number" }, level: "inhabituel" } as const;

/** The signals of one answer. Pure. A sole proprietor's registered name is never shown, and never compared. */
export function registrySignals(answer: RegistryAnswer, issuer: PrintedIssuer, source: string): RegistrySignal[] {
  if (answer.kind === ANSWER.unknown) {
    return [
      {
        ...base,
        signalId: "REG-001",
        observation: `The QST number printed on the document was not found in the ${source} register.`,
        mayIndicate: "A typing error, a number not yet registered, or a number that belongs to another business.",
        askFor: "Ask the issuer to confirm the QST number.",
        vars: { source },
      },
    ];
  }
  if (answer.kind !== ANSWER.found) {
    return [];
  }
  const signals: RegistrySignal[] = [];
  if (
    answer.status === FOUND_STATUS.struck &&
    answer.statusDate &&
    issuer.documentDate &&
    answer.statusDate.slice(0, 10) <= issuer.documentDate
  ) {
    signals.push({
      ...base,
      signalId: "REG-003",
      observation: `The ${source} register shows this registration revoked or cancelled as of ${answer.statusDate.slice(0, 10)}, on or before the date of the document.`,
      mayIndicate: "A registration closed and reopened under the same number, or a late filing.",
      askFor: "Ask the issuer for the current registration.",
      vars: { source, date: answer.statusDate.slice(0, 10) },
    });
  }
  const registered = [answer.legalName, answer.tradeName].filter((n): n is string => !!n);
  if (
    issuer.registrant === "business" &&
    issuer.name &&
    registered.length > 0 &&
    !registered.some((n) => sameName(issuer.name ?? "", n))
  ) {
    signals.push({
      ...base,
      signalId: "REG-002",
      observation: "The name printed on the document differs from the name in the register.",
      mayIndicate: "A trade name, a recent change of name, or an abbreviation.",
      where: `Document: ${issuer.name} · Register: ${registered.join(" / ")}`,
      askFor: "Ask the issuer how the two names relate.",
      vars: { document: issuer.name, register: registered.join(" / ") },
    });
  }
  return signals;
}

/** Looks the number up and returns the signals; `reason` says why the register did not answer (null when it did), so the report can say « not looked up » honestly. */
export async function checkIssuer(
  registry: BusinessRegistry,
  issuer: PrintedIssuer,
): Promise<{ looked: boolean; reason: NotLookedUpReason | null; signals: RegistrySignal[] }> {
  const answer = await registry.lookupQst(issuer.number);
  return {
    looked: answer.kind !== ANSWER.notLookedUp,
    reason: answer.kind === ANSWER.notLookedUp ? answer.reason : null,
    signals: registrySignals(answer, issuer, registry.source),
  };
}
