import type { ApiKeyRules } from "@krizaka/api-keys";

/** Verikora's API-key rules — data. */
export const VERIKORA_API_KEY_RULES: ApiKeyRules = {
  prefix: "yzk",
  scopes: ["checks:write", "reports:read", "contracts:seal"],
  secretBytes: 24,
  maxExpiryDays: 365,
  rotationGraceHours: 24,
  lastUsedEveryMinutes: 5,
};
