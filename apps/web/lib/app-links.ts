/**
 * Universal links (yomizaka#155): `https://www.yomizaka.com/fr/app/…` opens the app when it is installed, the page when it is not.
 * The two files that let a phone trust the link — Apple's `apple-app-site-association` and Android's `assetlinks.json` — are built
 * here from the app's own identity and from what signs it (the environment: never a certificate in the repository). A file with
 * nothing to say is not served: a claim the phone cannot check is worse than none.
 */
export const IOS_BUNDLE_ID = "com.krizaka.yomizaka";
export const ANDROID_PACKAGE = "com.krizaka.yomizaka";
/** The hosts whose links the app opens (apps/mobile/app.json lists the same: `npm run check:app-links` compares them). */
export const APP_LINK_HOSTS = ["www.yomizaka.com", "dev.yomizaka.com"] as const;
/** The signed-in space, in both languages: the screens of the app mirror these paths. The public pages stay on the web. */
export const APP_LINK_PATHS = ["/fr/app", "/fr/app/*", "/en/app", "/en/app/*"] as const;

export interface AppleAssociation {
  applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] };
}

/** Apple's file, for the team that signs the iOS app; null when the team is not known. */
export function appleAssociation(teamId: string | undefined): AppleAssociation | null {
  if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  return { applinks: { details: [{ appIDs: [`${teamId}.${IOS_BUNDLE_ID}`], components: APP_LINK_PATHS.map((path) => ({ "/": path })) }] } };
}

export interface AssetLink {
  relation: ["delegate_permission/common.handle_all_urls"];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** The SHA-256 fingerprints of a comma-separated setting, upper-cased; an entry that is not a fingerprint stops the file (never half served). */
export function fingerprintsOf(setting: string | undefined): string[] | null {
  const all = (setting ?? "").split(",").map((f) => f.trim().toUpperCase()).filter(Boolean);
  return all.length > 0 && all.every((f) => FINGERPRINT.test(f)) ? [...new Set(all)] : null;
}

/** Android's file, for the certificate(s) that sign the app; null when none is known. */
export function assetLinks(setting: string | undefined): AssetLink[] | null {
  const fingerprints = fingerprintsOf(setting);
  return fingerprints ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints } }] : null;
}
