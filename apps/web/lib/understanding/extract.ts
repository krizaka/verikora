import { EN_WORDS, FR_WORDS } from "./language-words";
import type {
  AmountFact,
  Confidence,
  DateFact,
  DocumentTypeDef,
  DocumentUnderstanding,
  IdentifierDef,
  Lang,
  PartyFact,
  ReferenceFact,
  Understanding,
} from "./port";

/**
 * The cheap pass: regular expressions and weighted signals read from DATA (types.ts). Deterministic — the same text gives the
 * same answer — and free. It never invents: a field it cannot read is absent, a nature it cannot tell is `null`.
 */
export interface UnderstandingConfig {
  types: readonly DocumentTypeDef[];
  identifiers: readonly IdentifierDef[];
  partyRoles: readonly { role: string; pattern: string }[];
  /** Score from which the nature is « high » / « medium » / « low »; under `low` it is unknown. */
  thresholds: { high: number; medium: number; low: number };
  /** Another nature within this share of the best score is reported as an alternative (and the pass counts as unsure). */
  alternativeShare: number;
}

/** One case-insensitive pattern out of alternatives written as sources. */
const wordsPattern = (...sources: string[]) => new RegExp(sources.join("|"), "iu");

function language(text: string): Lang {
  const fr = [...text.matchAll(FR_WORDS)].length;
  const en = [...text.matchAll(EN_WORDS)].length;
  if (fr + en < 3) return "unknown";
  return fr >= en ? "fr" : "en";
}

const MONTHS: Record<string, number> = {
  janvier: 1,
  january: 1,
  février: 2,
  fevrier: 2,
  february: 2,
  mars: 3,
  march: 3,
  avril: 4,
  april: 4,
  mai: 5,
  may: 5,
  juin: 6,
  june: 6,
  juillet: 7,
  july: 7,
  août: 8,
  aout: 8,
  august: 8,
  septembre: 9,
  september: 9,
  octobre: 10,
  october: 10,
  novembre: 11,
  november: 11,
  décembre: 12,
  decembre: 12,
  december: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

type Raw = { y: number; m: number; d: number; text: string; index: number };
function rawDates(text: string): Raw[] {
  const out: Raw[] = [];
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    if (validDate(+m[1]!, +m[2]!, +m[3]!)) out.push({ y: +m[1]!, m: +m[2]!, d: +m[3]!, text: m[0], index: m.index! });
  for (const m of text.matchAll(/\b(\d{1,2})(?:er)?\s+([a-zéûôè]{3,9})\s+(\d{4})\b/giu)) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (month && validDate(+m[3]!, month, +m[1]!))
      out.push({ y: +m[3]!, m: month, d: +m[1]!, text: m[0], index: m.index! });
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[1]!.toLowerCase()];
    if (month && validDate(+m[3]!, month, +m[2]!))
      out.push({ y: +m[3]!, m: month, d: +m[2]!, text: m[0], index: m.index! });
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g))
    if (validDate(+m[3]!, +m[2]!, +m[1]!)) out.push({ y: +m[3]!, m: +m[2]!, d: +m[1]!, text: m[0], index: m.index! });
  return out;
}

const KIND_BEFORE: readonly { kind: DateFact["kind"]; pattern: RegExp }[] = [
  { kind: "due", pattern: /[ée]ch[ée]ance|due\s+date|payable\s+avant|payer\s+avant|due\b/iu },
  {
    kind: "effective",
    pattern: /(?:en\s+vigueur|d[ée]but|effectif|date\s+d['’]effet|[àa]\s+compter\s+du|effective|starting|du\s*$)/iu,
  },
  {
    kind: "issued",
    pattern: wordsPattern(
      "[ée]mis",
      "d['’][ée]mission",
      String.raw`date\s+(?:de\s+la\s+facture|du\s+re[çc]u|de\s+l['’]inscription)`,
      "issued",
      String.raw`invoice\s+date`,
      String.raw`inscri\w+\s+le`,
      "signé",
      String.raw`sign[ée]\s+[àa]`,
      String.raw`date\s*:`,
    ),
  },
];

function dates(text: string): DateFact[] {
  const seen = new Set<string>();
  const facts: DateFact[] = [];
  for (const r of rawDates(text).sort((a, b) => a.index - b.index)) {
    const value = `${r.y}-${pad(r.m)}-${pad(r.d)}`;
    if (seen.has(value)) continue;
    seen.add(value);
    const before = text.slice(Math.max(0, r.index - 60), r.index);
    const kind = KIND_BEFORE.find((k) => k.pattern.test(before))?.kind ?? "other";
    facts.push({ kind, value, text: r.text });
    if (facts.length >= 12) break;
  }
  return facts;
}

const toCents = (raw: string): number | null => {
  const s = raw.replace(/[\s\u00a0]/g, "");
  const m = /^(\d+)(?:[.,](\d{2}))?$/.exec(s) ?? /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!.replace(/[.,]/g, "");
  return Number(whole) * 100 + (m[2] ? Number(m[2]) : 0);
};

const AMOUNT_KINDS: readonly { kind: AmountFact["kind"]; pattern: RegExp }[] = [
  { kind: "subtotal", pattern: /sous-?total|sub-?total/iu },
  { kind: "gst", pattern: /\bTPS\b|\bGST\b/u },
  { kind: "qst", pattern: /\bTVQ\b|\bQST\b/u },
  { kind: "total", pattern: /total|montant\s+d[ûu]|amount\s+due/iu },
  { kind: "deposit", pattern: /d[ée]p[ôo]t|deposit/iu },
  { kind: "rent", pattern: /loyer|\brent\b/iu },
];

const NUMBER = [String.raw`\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{2})?`, String.raw`\d+(?:[.,]\d{2})?`];
/** A number then its currency sign (`$`, `CAD`, `$ CAD`): the number is the first capture. */
const AMOUNT = new RegExp(String.raw`(${NUMBER.join("|")})\s*(?:\$|CAD|\$\s*CAD)`, "giu");

function amounts(text: string): AmountFact[] {
  const out: AmountFact[] = [];
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(AMOUNT)) {
      const cents = toCents(m[1]!);
      if (cents === null || cents === 0) continue;
      const before = line.slice(0, m.index);
      const kind = AMOUNT_KINDS.find((k) => k.pattern.test(before))?.kind ?? "other";
      out.push({ kind, cents, text: m[0].trim() });
      if (out.length >= 15) return out;
    }
  }
  return out;
}

type CompiledType = { t: DocumentTypeDef; signals: { re: RegExp; weight: number }[] };

/** The nature's confidence from the best score: under `low` it is unknown. */
function confidenceOf(
  best: { score: number } | undefined,
  { high, medium, low }: UnderstandingConfig["thresholds"],
): Confidence {
  if (!best || best.score < low) return "unknown";
  if (best.score >= high) return "high";
  return best.score >= medium ? "medium" : "low";
}

/** The first capture of each identifier's pattern: the references the text carries. */
function referencesOf(text: string, ids: readonly { i: IdentifierDef; re: RegExp }[]): ReferenceFact[] {
  const references: ReferenceFact[] = [];
  for (const { i, re } of ids) {
    const found = re.exec(text)?.[1];
    if (found) references.push({ kind: i.kind, value: found.replace(/\s+/g, " ").trim() });
  }
  return references;
}

/** The people and companies named after a role label (« Locateur : … »), each name once. */
function partiesOf(text: string, roles: readonly { role: string; re: RegExp }[]): PartyFact[] {
  const parties: PartyFact[] = [];
  for (const { role, re } of roles) {
    const value = re.exec(text)?.[1]?.split(/[,;(]/)[0]?.trim();
    if (value && value.length >= 2 && !parties.some((p) => p.name === value)) parties.push({ role, name: value });
  }
  return parties;
}

/** The issuer a nature declares, or the last of its issuer patterns that matches. */
function issuerOf(text: string, type: DocumentTypeDef): string | null {
  if (type.issuer) return type.issuer;
  let issuer: string | null = null;
  for (const p of type.issuerPatterns ?? []) issuer = new RegExp(p, "iu").exec(text)?.[1]?.trim() ?? issuer;
  return issuer;
}

export function createUnderstanding(config: UnderstandingConfig): DocumentUnderstanding {
  const compiled: CompiledType[] = config.types.map((t) => ({
    t,
    signals: t.signals.map((s) => ({ re: new RegExp(s.pattern, "iu"), weight: s.weight })),
  }));
  const ids = config.identifiers.map((i) => ({ i, re: new RegExp(i.pattern, "iu") }));
  const roles = config.partyRoles.map((r) => ({
    role: r.role,
    re: new RegExp(String.raw`^[\s•*-]*(?:${r.pattern})\s*(?:\([^)]*\))?\s*:\s*([^\n]{2,120})$`, "imu"),
  }));

  return {
    understand(text, context): Understanding {
      const scored = compiled
        .map(({ t, signals }) => ({ t, score: signals.reduce((sum, s) => sum + (s.re.test(text) ? s.weight : 0), 0) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const second = scored[1];
      const confidence = confidenceOf(best, config.thresholds);
      const nature =
        best && confidence !== "unknown" ? { id: best.t.id, label: best.t.label, confidence, score: best.score } : null;
      const close = !!best && !!second && second.score > 0 && second.score >= best.score * config.alternativeShare;
      const alternative = nature && close && second ? { id: second.t.id, label: second.t.label } : null;
      const known = nature && best ? best.t : null;

      return {
        nature,
        alternative,
        language: language(text),
        pages: context.pages,
        issuer: known ? issuerOf(text, known) : null,
        dates: dates(text),
        parties: partiesOf(text, roles),
        references: referencesOf(text, ids),
        amounts: amounts(text),
        check: known ? known.check : null,
        authenticity: known ? known.authenticity !== false : true,
        needsModel: confidence === "unknown" || confidence === "low" || (close && confidence !== "high"),
      };
    },
  };
}
