import { refuse } from "../http";
import { checksDoor } from "../sovkora";
import { liveGate } from "./gate";
import {
  CHECK_OUTCOME,
  type CheckCall,
  type CheckPurpose,
  type CheckResult,
  type ChecksDoor,
  closedDoor,
  NOT_CONFIGURED,
} from "./model";

/**
 * A screening provider behind one port. Verikora never speaks to a credit bureau or a court-records vendor: it asks
 * Sovkora's external-checks connector (the engine's `ExternalCheckService`), which routes by data. The adapter is chosen by
 * the provider row's `adapter` key (data, no deploy): `demo` (fictitious) or `engine` (Sovkora's door).
 */
export interface CheckProvider {
  /** True when the data is fictitious: the pages say so. */
  demo: boolean;
  submit(purpose: CheckPurpose, call: CheckCall): Promise<CheckResult>;
  /** A pending answer is collected by polling the same provider with its reference (webhooks later). */
  collect(purpose: CheckPurpose, call: CheckCall, providerRef: string): Promise<CheckResult>;
}

const result = (outcome: CheckResult["outcome"], extra: Partial<CheckResult> = {}): CheckResult => ({
  outcome,
  refusal: null,
  category: "NONE",
  providerRef: null,
  ...extra,
});

export { type ChecksDoor, closedDoor, NOT_CONFIGURED };

/**
 * A live adapter is wrapped by the compliance gate (verikora#135): while the gate is closed the door is never reached and the
 * answer is NOT_CONFIGURED — whatever the door is. The gate is read on every call, so closing a blocker stops live calls at once.
 */
export const engineProvider = (
  door: ChecksDoor = closedDoor,
  open: () => Promise<boolean> = async () => (await liveGate()).open,
): CheckProvider => ({
  demo: false,
  submit: async (p, c) => ((await open()) ? door.submit(p, c) : NOT_CONFIGURED),
  collect: async (p, c, ref) => ((await open()) ? door.collect(p, c, ref) : NOT_CONFIGURED),
});

/**
 * The demo: fictitious and deterministic, by the last name. « Flag… » is a file found; « Wait… » is accepted and answered on the
 * first collection (no file); « Waitforever… » stays pending; any other is no file.
 */
export const demoProvider: CheckProvider = {
  demo: true,
  async submit(_purpose, call) {
    const name = call.subject.lastName.toLowerCase();
    if (name.startsWith("wait"))
      return result(CHECK_OUTCOME.PENDING, {
        providerRef: name.startsWith("waitforever") ? "demo-pending-forever" : "demo-pending-01",
      });
    return name.startsWith("flag")
      ? result(CHECK_OUTCOME.MATCH, { category: "TAL_OTHER", providerRef: "demo-fixture-01" })
      : result(CHECK_OUTCOME.NO_MATCH);
  },
  async collect(_purpose, _call, providerRef) {
    return providerRef === "demo-pending-forever"
      ? result(CHECK_OUTCOME.PENDING, { providerRef })
      : result(CHECK_OUTCOME.NO_MATCH);
  },
};

/** The adapters by key: a provider row names one. Adding a vendor is a row for the engine; a new adapter is code only for a new kind of door. */
export const ADAPTERS: Record<string, () => CheckProvider> = {
  demo: () => demoProvider,
  engine: () => engineProvider(checksDoor()),
};

export function adapterFor(key: string): CheckProvider {
  const make = ADAPTERS[key];
  if (!make) throw refuse(503, "PROVIDER_UNAVAILABLE", "No such screening adapter");
  return make();
}
