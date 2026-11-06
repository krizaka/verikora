import { CHECK_STEP, type CheckStep, STEP_STATE } from "@verikora/core";

/** The states of the contract (`@verikora/core` `checkSteps`) as the Krizaka `Stepper` names them, on the web, the phone and the Mac. */
export const STEPPER_STATUS = {
  [STEP_STATE.done]: "done",
  [STEP_STATE.current]: "current",
  [STEP_STATE.upcoming]: "upcoming",
  [STEP_STATE.failed]: "error",
} as const;

export interface StepperStep {
  title: string;
  status: (typeof STEPPER_STATUS)[keyof typeof STEPPER_STATUS];
  description?: string;
}

/** What a `Stepper` draws of the steps of a check; `say` translates a key of the shared messages (`steps.*`). */
export function stepperSteps(steps: readonly CheckStep[], say: (key: string) => string): StepperStep[] {
  return steps.map((step) => ({
    title: say(step.id === CHECK_STEP.rules ? `steps.rules.${step.studio}` : `steps.${step.id}`),
    status: STEPPER_STATUS[step.state],
    ...(step.state === STEP_STATE.current ? { description: say("steps.working") } : {}),
  }));
}
