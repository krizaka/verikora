import { type AppConfigRecord, defaultRecord, formatVersion, parseVersion, type Platform } from "@krizaka/app-config";

import { PRODUCT_NAME } from "./brand";
import { appSettings } from "./settings/instance";
import { signupOpenNow } from "./settings/signup";

/** A version the setting holds only if it reads as one: a typo in the administration must not lock every app out. */
const versionOr = (text: string, fallback: string) => {
  const version = parseVersion(text);
  return version ? formatVersion(version) : fallback;
};

type MailEnv = Parameters<typeof signupOpenNow>[0];

/**
 * The parameters the apps read at `GET /api/app-config`, built from the settings (never typed here): the same `signupOpenNow` (the mail environment comes from the edge) as the
 * sign-up page and route, the version bounds, the maintenance switch and its message. No personal data.
 */
export async function appConfigRecord(platform: Platform, mail: MailEnv): Promise<AppConfigRecord> {
  const settings = appSettings();
  const base = defaultRecord(platform);
  const [signupOpen, minVersion, latestVersion, maintenanceOn, maintenanceMessage] = await Promise.all([
    signupOpenNow(mail),
    settings.get("app.minVersion"),
    settings.get("app.latestVersion"),
    settings.get("app.maintenance"),
    settings.get("app.maintenanceMessage"),
  ]);
  return {
    ...base,
    minSupportedVersion: versionOr(minVersion, base.minSupportedVersion),
    latestVersion: versionOr(latestVersion, base.latestVersion),
    maintenanceOn,
    maintenanceMessage,
    flags: { signupOpen, productName: PRODUCT_NAME },
  };
}
