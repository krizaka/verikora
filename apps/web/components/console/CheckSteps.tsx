"use client";

import { Stepper, type StepStatus } from "@krizaka/ui/stepper";
import { CHECK_STEP, type CheckStep, STEP_STATE } from "@verikora/core";

import { useSay } from "@/lib/i18n-client";

const STATUS_OF: Record<CheckStep["state"], StepStatus> = {
  [STEP_STATE.done]: "done",
  [STEP_STATE.current]: "current",
  [STEP_STATE.upcoming]: "upcoming",
  [STEP_STATE.failed]: "error",
};

/**
 * A check's progress — Lecture, Contrôle préalable, Vérification, Rapport — drawn with Krizaka UI's `Stepper`. The steps and their
 * states come from `@verikora/core` (`checkSteps`), the same contract the Mac, iOS and Android apps draw; this only translates and draws.
 */
export function CheckSteps({
  steps,
  orientation = "horizontal",
}: Readonly<{ steps: readonly CheckStep[]; orientation?: "horizontal" | "vertical" }>) {
  const { say } = useSay();
  const title = (s: CheckStep) => say(s.id === CHECK_STEP.rules ? `steps.rules.${s.studio}` : `steps.${s.id}`);
  return (
    <Stepper
      aria-label={say("steps.label")}
      orientation={orientation}
      data-testid="check-steps"
      labels={{
        done: say("steps.state.done"),
        current: say("steps.state.current"),
        upcoming: say("steps.state.upcoming"),
        error: say("steps.state.error"),
      }}
      steps={steps.map((s) => ({
        title: title(s),
        status: STATUS_OF[s.state],
        description: s.state === STEP_STATE.current ? say("steps.working") : undefined,
      }))}
    />
  );
}
