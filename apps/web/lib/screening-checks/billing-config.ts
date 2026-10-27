import { appSettings } from "../settings/instance";
import { type BillingPort, closedBilling } from "./billing";

/**
 * The port that bills a screening check, or null while billing is off (`features.screeningBilling`, off by default). With the flag
 * on, the port is the closed one until `@krizaka/payments` can charge a check (see billing.ts): a flag turned on by mistake bills nothing.
 */
export async function screeningBillingPort(): Promise<BillingPort | null> {
  return (await appSettings().get("features.screeningBilling")) === true ? closedBilling : null;
}
