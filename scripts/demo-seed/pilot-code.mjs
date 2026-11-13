// The dev pilot code (krizaka-internal#3230): a credit code with the purpose « demo », so the pilot can be tried on a dev database.
// The allowance (ONE file) is a placeholder: the founder decides the real number, and the admin edits it in the console (Coupons tab). Production has no seeded
// value (the cast refuses a production database, `assertNotProduction`), and a code the admin already has under this name is left as it is.
export const DEV_PILOT_CODE = "PILOTDEV1";
export const DEV_PILOT_FILES = 1;
// @fixed: the id of the one seeded code, so a second run finds it (and the console links to it)
export const DEV_PILOT_ID = "00000000-0000-4000-8000-000000003230";
// @fixed: how long the free file stays usable after the code is typed, and how many accounts the dev code opens
const VALID_DAYS = 30;
const MAX_ACCOUNTS = 100;

/** Seeds the dev pilot code through `run(sql, values)`; idempotent. Returns whether a row was written. */
export async function seedPilotCode(run, now) {
  const rows = await run(
    `INSERT INTO coupons.coupon (id, code, code_key, kind, purpose, status, starts_at, max_redemptions, credits, credits_valid_days, on_exhausted, created_at, updated_at)
     VALUES ($1, $2, $2, 'credit', 'demo', 'active', $3, $4, $5, $6, 'fallback_paid', $3, $3)
     ON CONFLICT (code_key) DO NOTHING RETURNING id`,
    [DEV_PILOT_ID, DEV_PILOT_CODE, now, MAX_ACCOUNTS, DEV_PILOT_FILES, VALID_DAYS],
  );
  return rows.length > 0;
}
