import { longDate, money } from "../prices/format";
import type { SectionGResult } from "./section-g";
import type { SectionGDeadline } from "./section-g-deadline";
import { sectionGRequestSummary } from "./section-g-request";

type Lang = "en" | "fr";
type Messages = Record<string, string>;

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const day = (iso: string, lang: Lang) => longDate(new Date(`${iso}T12:00:00Z`), lang);

/**
 * The sentences that follow a Section G finding: when the request to the TAL can be made (the basis of the deadline) and the facts to take
 * to it (`sectionGRequestSummary`), in the reader's language. Only a finding with a recourse has any; the deadline's own wording says how
 * days and months are counted is for the TAL or a lawyer to confirm. Verikora files nothing: the summary is for the tenant to carry.
 * These sentences carry no disclaimer of their own: the finding says it once, at its end (`sectionG.disclaimer`, `sectionGFinding`).
 */
export function requestSentences(
  result: SectionGResult,
  deadline: SectionGDeadline | null,
  lang: Lang,
  text: { deadline: Messages; request: Messages },
): string[] {
  const summary = sectionGRequestSummary(
    result,
    deadline ?? {
      state: "no-claim",
      basis: null,
      lastDay: null,
      daysLeft: null,
      citation: "C.c.Q., art. 1950",
      sourceUrl: "https://www.tal.gouv.qc.ca/fr/signature-d-un-bail/avis-au-nouveau-locataire",
    },
  );
  if (summary.lines.length === 0) return [];
  const lines = summary.lines.map((l) => {
    const values = { ...l.values };
    if (typeof values.cents === "number") values.cents = money(values.cents, lang);
    if (typeof values.lastDay === "string") values.lastDay = day(values.lastDay, lang);
    return fill(text.request[l.key] ?? "", values);
  });
  const basis = deadline?.basis ? [text.deadline[deadline.basis] ?? ""] : [];
  return [...basis, `${text.request.title ?? ""} ${lines.join(" ")}`.trim()].filter(Boolean);
}
