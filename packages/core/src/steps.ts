import type { AnalysisStatus, Studio } from "./index";

/**
 * The steps of a check, one contract for every platform (the web, the Mac, iOS and Android apps): Lecture, Contrôle préalable,
 * Vérification, Rapport. Each app draws them with its own components and translates the ids; none invents a step. The state of
 * each is DERIVED from what the product really knows (the document read, accepted, the run's status) — Sovkora's per-step live
 * events (sovkora#189) will refine the rules step through the same shape when they exist; nothing is faked until then.
 */
export const CHECK_STEP = { read: "read", preflight: "preflight", rules: "rules", report: "report" } as const;
export type CheckStepId = (typeof CHECK_STEP)[keyof typeof CHECK_STEP];
export const CHECK_STEP_IDS = [CHECK_STEP.read, CHECK_STEP.preflight, CHECK_STEP.rules, CHECK_STEP.report] as const;

export const STEP_STATE = { done: "done", current: "current", upcoming: "upcoming", failed: "failed" } as const;
export type StepState = (typeof STEP_STATE)[keyof typeof STEP_STATE];

export interface CheckStep {
  id: CheckStepId;
  state: StepState;
  /** The Studio whose work the « rules » step is (its name differs: rules for a compliance check, the file for an authenticity check). */
  studio: Studio;
}

export interface CheckProgress {
  /** Whether a text layer was read from the document. */
  hasText: boolean;
  /** The latest run of the check being followed, or none yet. */
  analysis: { studio: Studio; status: AnalysisStatus } | null;
  /** The Studio asked for when there is no run yet (a compliance check by default). */
  studio?: Studio;
}

export function checkSteps({ hasText, analysis, studio }: CheckProgress): CheckStep[] {
  const kind: Studio = analysis?.studio ?? studio ?? "compliance-check";
  const needsText = kind === "compliance-check";
  const readFailed = needsText && !hasText;
  const run = analysis?.status;
  const ruleState = (): StepState => {
    if (readFailed || run === undefined) return STEP_STATE.upcoming;
    if (run === "running") return STEP_STATE.current;
    return run === "succeeded" ? STEP_STATE.done : STEP_STATE.failed;
  };
  const rules = ruleState();
  const state: Record<CheckStepId, StepState> = {
    read: readFailed ? STEP_STATE.failed : STEP_STATE.done,
    preflight: readFailed ? STEP_STATE.upcoming : STEP_STATE.done,
    rules,
    report: run === "succeeded" ? STEP_STATE.done : STEP_STATE.upcoming,
  };
  return CHECK_STEP_IDS.map((id) => ({ id, state: state[id], studio: kind }));
}
