import type { ApiKeyRules } from "@krizaka/api-keys";

/** Yomizaka's API-key rules — data. */
export const YOMIZAKA_API_KEY_RULES: ApiKeyRules = {
  prefix: "yzk",
  scopes: ["checks:write", "reports:read", "contracts:seal"],
  secretBytes: 24,
  maxExpiryDays: 365,
  rotationGraceHours: 24,
  lastUsedEveryMinutes: 5,
};
