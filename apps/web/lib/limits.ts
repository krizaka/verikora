import { createLimiter, type Limiter, memoryLimitStore, RateLimited } from "@krizaka/rate-limit";
import { limitsFromSettings } from "@krizaka/rate-limit/settings";

import { systemClock } from "../app/system-clock";
import { clientAddress } from "./client-address";
import { HttpError } from "./http";
import { logError } from "./log";
import { appSettings } from "./settings/instance";
import { LIMIT_DEFAULTS, type LimitAction } from "./settings/limits";
import { isSettingKey } from "./settings/registry";

/**
 * The action limits of the API (`@krizaka/rate-limit`): fixed windows per address and per subject, the numbers read from the settings
 * (`limits.<action>.perIp|perSubject|windowSeconds`, the administrator's, no redeploy) with today's values as defaults. Windows are kept
 * in this process (one instance on dev: enough; the package's PostgreSQL store is the day a second instance runs). If the settings
 * cannot be read the defaults apply, so a database outage never removes a limit nor takes a route down.
 */
let store = memoryLimitStore();

// An action has a per-subject setting only if it has a per-subject limit: a key the registry does not declare is "no limit of that kind", not an error.
const read = limitsFromSettings((key) => (isSettingKey(key) ? (appSettings().get(key) as Promise<number>) : undefined));

async function limitSettingsOf(action: LimitAction) {
  try {
    return (await read(action)) ?? LIMIT_DEFAULTS[action];
  } catch (error) {
    logError("limits: settings unreadable, defaults apply", error);
    return LIMIT_DEFAULTS[action];
  }
}

const limiterFor = (limits: (counter: string) => ReturnType<typeof limitSettingsOf>): Limiter =>
  createLimiter({
    store,
    clock: systemClock,
    limits,
    onStoreError: (error, action) => logError(`limits: store failed for ${action}`, error),
  });

/** A refusal is 429 `RATE_LIMITED` with `Retry-After`. */
function refusal(error: unknown): unknown {
  return error instanceof RateLimited
    ? new HttpError(
        429,
        "Too many requests",
        { code: error.code, retryAfterSeconds: error.retryAfterSeconds },
        error.headers,
      )
    : error;
}

async function enforce(limiter: Limiter, counter: string, req: { headers: Headers }, subject: string | null) {
  try {
    await limiter.enforce(counter, { ip: clientAddress(req.headers), subject });
  } catch (error) {
    throw refusal(error);
  }
}

/**
 * Limits an action per address and per subject (an address, an account): throws a 429. `counter` names the windows when one setting
 * is shared by several counters (the account actions: each scope counts apart, under the same read and write limits).
 */
export function limit(
  action: LimitAction,
  req: { headers: Headers },
  subject: string | null,
  counter: string = action,
) {
  return enforce(
    limiterFor(() => limitSettingsOf(action)),
    counter,
    req,
    subject,
  );
}

/** The same, for a limit that is not a setting of the action: an API key's per-minute allowance is its owner's plan (`limits.apiRequestsPerMinute`). */
export function limitWith(
  counter: string,
  req: { headers: Headers },
  subject: string | null,
  perIp: number,
  perSubject: number,
  windowSeconds: number,
) {
  return enforce(
    limiterFor(async () => ({ perIp, perSubject, windowSeconds })),
    counter,
    req,
    subject,
  );
}

/** For tests: forget every window. */
export function resetRateLimits() {
  store = memoryLimitStore();
}
