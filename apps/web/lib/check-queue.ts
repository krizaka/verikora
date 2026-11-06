import type { DocumentKind } from "@verikora/core";

/*
 * The check flow's logic (verikora#326, P9 of the design direction § 5.4), pure: the defaults said before the drop
 * (Errata 6), and one row per file that landed, moving through words. The upload itself is the queue of
 * @krizaka/ui/file-upload; a row starts once the file landed. The run's own stages come with #208 (sovkora#189); until
 * then a row says the request's stages.
 */

/** The defaults, said in one line before the drop (« Effacé après la vérification · Règles du Québec en vigueur aujourd'hui · dans « Mes documents » »). */
export function checkDefaults({ keep, keepOff }: { keep: boolean; keepOff: boolean }): string[] {
  return [
    keep && !keepOff ? "check.defaults.kept" : "check.defaults.erased",
    "check.defaults.rules",
    "check.defaults.place",
  ];
}

/** A row's stages, each said in words (`check.stages.<stage>`): progress is never a bare bar, and stays read under reduced motion. */
export const CHECK_STAGES = ["reading", "starting", "asking", "started", "refused"] as const;
export type CheckStage = (typeof CHECK_STAGES)[number];

export interface CheckRow {
  id: string;
  filename: string;
  stage: CheckStage;
  /** The engine's refusal (a code the report tab says), when it refused. */
  refused: string | null;
}

export type CheckEvent =
  | { type: "landed"; document: { id: string; filename: string } }
  | {
      type: "outcome";
      id: string;
      outcome: { started: boolean; refused: string | null };
      requested: DocumentKind | "auto";
    }
  | { type: "picked"; id: string };

const stageOf = (
  outcome: { started: boolean; refused: string | null },
  requested: DocumentKind | "auto",
): CheckStage => {
  if (outcome.refused) return "refused";
  // Nothing sure under « auto »: asked here. A kind the person named that did not start goes to the report tab, which confirms it.
  return outcome.started || requested !== "auto" ? "started" : "asking";
};

/** The rows after an event: a file landed (once, even when it lands twice), its outcome, or the kind picked for it. */
export function checkRows(rows: readonly CheckRow[], event: CheckEvent): CheckRow[] {
  switch (event.type) {
    case "landed":
      return rows.some((r) => r.id === event.document.id)
        ? [...rows]
        : [...rows, { id: event.document.id, filename: event.document.filename, stage: "reading", refused: null }];
    case "outcome":
      return rows.map((r) =>
        r.id === event.id
          ? { ...r, stage: stageOf(event.outcome, event.requested), refused: event.outcome.refused }
          : r,
      );
    case "picked":
      return rows.map((r) => (r.id === event.id ? { ...r, stage: "starting" } : r));
  }
}

/** A single file opens its report as soon as it is under way; with several, each row links to its own. */
export const opensAtOnce = (dropped: number): boolean => dropped === 1;

/** A row's report, a refusal carried in the address for the report tab to say. */
export const reportHref = (locale: string, row: Pick<CheckRow, "id" | "refused">): string => {
  const query = row.refused ? `?refused=${encodeURIComponent(row.refused)}` : "";
  return `/${locale}/app/documents/${row.id}/rapport${query}`;
};

/** The check flow's four steps (krizaka-internal#1899): drop, then the kind when asked, then the run, then the report. */
export const FLOW_STEPS = ["drop", "kind", "running", "result"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/**
 * Where the flow stands, from the rows: nothing dropped is « drop »; a file waiting for its kind is « kind » (it comes first,
 * the person must answer); a file being read or started is « running »; every file under way or refused is « result ».
 */
export function flowStep(rows: readonly Pick<CheckRow, "stage">[]): FlowStep {
  if (!rows.length) {
    return "drop";
  }
  if (rows.some((r) => r.stage === "asking")) {
    return "kind";
  }
  if (rows.some((r) => r.stage === "reading" || r.stage === "starting")) {
    return "running";
  }
  return "result";
}
