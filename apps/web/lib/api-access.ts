import {
  API_KEY_CODE,
  type ApiKeyCode,
  ApiKeyError,
  type ApiKeys,
  type Clock,
  createApiKeys,
  pgApiKeyStore,
} from "@krizaka/api-keys";

import { VERIKORA_API_KEY_RULES } from "./api-keys";
import { entitlementOf } from "./billing";
import { query } from "./db";
import { refuse } from "./http";
import { limit, limitWith } from "./limits";
import { assertFeature, settingsFor } from "./settings/guards";

/**
 * API keys in Verikora (ADR-0011): the generic module (`lib/api-keys`) wired to this app's database, plans, switches and rate
 * limits. The module knows nothing of any of them; this file is the only place that does.
 */
export const apiKeys = (clock: Clock): ApiKeys =>
  createApiKeys({ store: pgApiKeyStore(query), rules: VERIKORA_API_KEY_RULES, clock });

/** The HTTP answer of each refusal: stable codes the page translates and the API documents. */
const ANSWER: Record<ApiKeyCode, number> = {
  [API_KEY_CODE.missing]: 401,
  [API_KEY_CODE.invalid]: 401,
  [API_KEY_CODE.expired]: 401,
  [API_KEY_CODE.revoked]: 401,
  [API_KEY_CODE.superseded]: 401,
  [API_KEY_CODE.scope]: 403,
  [API_KEY_CODE.scopeUnknown]: 400,
  [API_KEY_CODE.name]: 400,
  [API_KEY_CODE.expiry]: 400,
  [API_KEY_CODE.limit]: 409,
  [API_KEY_CODE.notFound]: 404,
};

export const keyRefusal = (code: ApiKeyCode) => refuse(ANSWER[code], code, `API key refused: ${code}`);

/** Runs a key action; a refusal of the module becomes its stable HTTP answer. */
export async function keyAct<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiKeyError) throw keyRefusal(error.code);
    throw error;
  }
}

/** How many keys this person's plan lets them hold (an administrator sets it per plan; 0 = the plan has no API). */
export async function maxActiveKeys(accountId: string, now: Date): Promise<number> {
  const [entitlement, settings] = await Promise.all([entitlementOf(query, accountId, now), settingsFor(accountId)]);
  return settings[entitlement.pro ? "plans.pro.apiKeys" : "plans.free.apiKeys"].value as number;
}

/** The person may manage keys: the global switch is on, and the plan holds at least one. */
export async function assertKeysAllowed(accountId: string, now: Date): Promise<number> {
  await assertFeature("apiKeys", accountId);
  const max = await maxActiveKeys(accountId, now);
  if (max < 1) throw refuse(403, "API_PLAN", "Your plan does not include API keys");
  return max;
}

/**
 * The caller of an API route that takes a key (`Authorization: Bearer yzk_…`): its owner and key, or the refusal — 401 for a key
 * that is missing, wrong, expired, revoked or replaced, 403 for a scope it lacks, a switch that is off or a plan without an API,
 * 429 past the per-minute limit. A refused key costs a rate-limit hit on the caller's address, so guessing is slow.
 */
export async function requireApiKey(
  req: Request,
  scope: string,
  clock: Clock,
): Promise<{ ownerId: string; keyId: string }> {
  await limit("apiKeyAuth", req, null);
  const result = await apiKeys(clock).authenticate(req.headers.get("authorization"), scope);
  if (!result.ok) throw keyRefusal(result.code);
  const { ownerId, id } = result.key;
  await assertFeature("apiKeys", ownerId);
  if ((await maxActiveKeys(ownerId, clock.now())) < 1)
    throw refuse(403, "API_PLAN", "Your plan does not include API keys");
  const perMinute = (await settingsFor(ownerId))["limits.apiRequestsPerMinute"].value as number;
  await limitWith("apiKey", req, id, perMinute * 2, perMinute, 60);
  return { ownerId, keyId: id };
}
