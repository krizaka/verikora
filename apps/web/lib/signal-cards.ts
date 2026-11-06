import { format } from "@krizaka/i18n";
import { type Signal, SIGNAL_FAMILIES, type SignalFamily, signalFamily } from "@verikora/core";

/**
 * The cards of a document's traces of editing (ADR-0014, verikora#625), pure. A card says what was observed in the file, where, its
 * ordinary explanations and what to ask for — never that a document is false and never a total: no score, no sort of any kind
 * across signals or people. The words are messages (`console.analysis.traces.*`); `say` reads them by their key under `traces`.
 */
export type TraceSay = (key: string, vars?: Record<string, string | number>) => string;

/** A `TraceSay` over a messages table (`console.analysis.traces`), for a page that is handed its words rather than reading a provider: a dotted key, `{name}` variables. */
export const sayFrom =
  (table: object): TraceSay =>
  (key, vars) => {
    const found = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table);
    return typeof found === "string" ? format(found, vars) : key;
  };

export interface TraceGroup<T = Signal> {
  family: SignalFamily;
  signals: T[];
}

/** The signals by family, in the order a report reads them (history, layout, images, figures, across); within a family, as the engine sent them. */
export function groupByFamily<T extends Pick<Signal, "signalId" | "family">>(signals: readonly T[]): TraceGroup<T>[] {
  return SIGNAL_FAMILIES.map((family) => ({
    family,
    signals: signals.filter((s) => signalFamily(s) === family),
  })).filter((g) => g.signals.length > 0);
}

/** Where the signal sits in the file, as words: the page, the later save, the field. Empty when the engine gave no evidence. */
export function evidenceLines(say: TraceSay, s: Pick<Signal, "evidence">): string[] {
  const e = s.evidence;
  if (!e) {
    return [];
  }
  return [
    e.page ? say("page", { page: e.page }) : "",
    e.revision ? say("revision", { revision: e.revision }) : "",
    e.field ? say("field", { field: e.field }) : "",
  ].filter(Boolean);
}

/** The evidence and the engine's own « where », on one line. */
export const whereOf = (say: TraceSay, s: Pick<Signal, "evidence" | "where">): string =>
  [...evidenceLines(say, s), s.where].filter(Boolean).join(" · ");

/** What to ask the applicant or the issuer for: the engine's own line when it sent one, else the family's. */
export const askForOf = (say: TraceSay, s: Pick<Signal, "askFor" | "signalId" | "family">): string =>
  s.askFor ?? say(`askFor.${signalFamily(s)}`);

/** The ordinary explanations of the family, which every card carries next to what the signal may indicate. */
export const ordinaryOf = (say: TraceSay, s: Pick<Signal, "signalId" | "family">): string =>
  say(`ordinary.${signalFamily(s)}`);

/** The tone of a level: never red. « Inconsistent » is a warning, because red reads as a verdict. */
export const levelTone = (level: string): "neutral" | "warning" => (level === "observé" ? "neutral" : "warning");

/** The words a trace may never use, in either language (ADR-0014 §1), as whole words (letters on either side make another word), and the percent sign. */
const REFUSED = [
  "forged",
  "forgery",
  "fake",
  "fakes",
  "fraud",
  "fraudulent",
  "falsified",
  "counterfeit",
  "risk score",
  "score",
  "scores",
  "faux",
  "fausse",
  "falsifié",
  "falsifiée",
  "frauduleux",
  "frauduleuse",
  "fraude",
  "contrefait",
  "contrefaite",
  "trafiqué",
  "trafiquée",
];
export const VERDICT_WORDS = new RegExp(String.raw`(?<!\p{L})(?:${REFUSED.join("|")})(?!\p{L})|%`, "iu");
