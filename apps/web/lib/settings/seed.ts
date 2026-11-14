import { seedLegacySettings as seed } from "@krizaka/settings";

import { type SettingKey, settings } from "./registry";
import type { VerikoraSettings } from "./service";

/**
 * A deployment that was configured by environment before settings existed keeps behaving the same (the package's rule): at server
 * start, each legacy value that differs from the registry's default is written ONCE as a global setting, only when nobody has set it since.
 */
export interface LegacyValues {
  signupOpen: boolean;
  purgeAfterHours: number;
}

const LEGACY_KEYS = { signupOpen: "signup.open", purgeAfterHours: "limits.purgeAfterHours" } as const satisfies Record<
  keyof LegacyValues,
  SettingKey
>;

export const seedLegacyValues = (service: VerikoraSettings, legacy: LegacyValues, now: Date): Promise<SettingKey[]> =>
  seed(
    settings,
    service,
    Object.fromEntries((Object.keys(LEGACY_KEYS) as (keyof LegacyValues)[]).map((f) => [LEGACY_KEYS[f], legacy[f]])),
    now,
  );
