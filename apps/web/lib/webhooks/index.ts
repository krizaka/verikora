import { createWebhooks, type WebhookRules, type Webhooks } from "@krizaka/webhooks";

import { entitlementOf } from "../billing";
import { query } from "../db";
import { settingsFor } from "../settings/guards";
import { WEBHOOK_EVENTS } from "./events";
import { sealer } from "./seal";

/**
 * Webhooks in Verikora (verikora#241): the generic module (`@krizaka/webhooks`) wired to this app's database, plans and settings.
 * The module knows nothing of any of them; the secret to seal with is given by the caller (the edge reads the environment).
 */
export const BACKOFF_SECONDS = [30, 300, 1800, 7200, 43200] as const;

export const webhooksFor = (serverSecret: string, maxAttempts: number): Webhooks => {
  const rules: WebhookRules = { events: WEBHOOK_EVENTS, maxAttempts, backoffSeconds: BACKOFF_SECONDS };
  return createWebhooks({ query: (sql, params) => query(sql, params) as never, rules, secrets: sealer(serverSecret) });
};

/** How many endpoints this person's plan lets them register (an administrator sets it per plan; 0 = the plan has no webhooks). */
export async function maxEndpoints(accountId: string, now: Date): Promise<number> {
  const [entitlement, settings] = await Promise.all([entitlementOf(query, accountId, now), settingsFor(accountId)]);
  return settings[entitlement.pro ? "plans.pro.webhookEndpoints" : "plans.free.webhookEndpoints"].value as number;
}
