import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { GET as appleRoute } from "@/app/.well-known/apple-app-site-association/route";
import { GET as androidRoute } from "@/app/.well-known/assetlinks.json/route";

import { ANDROID_PACKAGE, APP_LINK_HOSTS, APP_LINK_PATHS, appleAssociation, assetLinks, fingerprintsOf, IOS_BUNDLE_ID } from "./app-links";

/** Universal links (yomizaka#155): the web's two files and the app's own configuration say the same thing. `pnpm check:app-links` runs this file. */
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, "0").toUpperCase()).join(":");
const appJson = JSON.parse(readFileSync(fileURLToPath(new URL("../../mobile/app.json", import.meta.url)), "utf8")).expo;

describe("Apple's apple-app-site-association", () => {
  it("names the app by its team and bundle, and the paths of the signed-in space in both languages", () => {
    expect(appleAssociation("ABCDE12345")).toEqual({ applinks: { details: [{ appIDs: [`ABCDE12345.${IOS_BUNDLE_ID}`], components: APP_LINK_PATHS.map((path) => ({ "/": path })) }] } });
    expect(APP_LINK_PATHS).toEqual(["/fr/app", "/fr/app/*", "/en/app", "/en/app/*"]);
  });

  it("says nothing when the team is not known or not a team id", () => {
    for (const bad of [undefined, "", "abcde12345", "SHORT", "TOOLONG123456"]) expect(appleAssociation(bad)).toBeNull();
  });
});

describe("Android's assetlinks.json", () => {
  it("names the package and the certificate(s) that sign it", () => {
    expect(assetLinks(FINGERPRINT.toLowerCase())).toEqual([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FINGERPRINT] } }]);
    expect(fingerprintsOf(`${FINGERPRINT}, ${FINGERPRINT}`)).toEqual([FINGERPRINT]);
  });

  it("is not served half: one entry that is not a SHA-256 fingerprint stops the file", () => {
    for (const bad of [undefined, "", "AB:CD", `${FINGERPRINT},nope`, FINGERPRINT.replaceAll(":", "")]) expect(assetLinks(bad)).toBeNull();
  });
});

describe("the two routes", () => {
  const TEAM = "APP_IOS_TEAM_ID";
  const CERT = "APP_ANDROID_CERT_SHA256";
  const saved = { team: process.env[TEAM], cert: process.env[CERT] };
  const restore = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  afterEach(() => {
    restore(TEAM, saved.team);
    restore(CERT, saved.cert);
  });

  it("answer 404 until what signs the app is set", async () => {
    delete process.env[TEAM];
    delete process.env[CERT];
    expect((await appleRoute()).status).toBe(404);
    expect((await androidRoute()).status).toBe(404);
  });

  it("answer JSON once it is", async () => {
    process.env[TEAM] = "ABCDE12345";
    process.env[CERT] = FINGERPRINT;
    const apple = await appleRoute();
    expect(apple.status).toBe(200);
    expect(apple.headers.get("content-type")).toContain("application/json");
    expect(await apple.json()).toMatchObject({ applinks: { details: [{ appIDs: [`ABCDE12345.${IOS_BUNDLE_ID}`] }] } });
    expect(await (await androidRoute()).json()).toMatchObject([{ target: { package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FINGERPRINT] } }]);
  });
});

describe("the app's configuration (apps/mobile/app.json) says the same", () => {
  it("has the bundle id and package the files name", () => {
    expect(appJson.ios.bundleIdentifier).toBe(IOS_BUNDLE_ID);
    expect(appJson.android.package).toBe(ANDROID_PACKAGE);
  });

  it("opens links of the same hosts on iOS (associated domains) and on Android (verified intent filter)", () => {
    expect([...appJson.ios.associatedDomains].sort()).toEqual(APP_LINK_HOSTS.map((host) => `applinks:${host}`).sort());
    const filter = appJson.android.intentFilters.find((f: { autoVerify?: boolean }) => f.autoVerify);
    expect(filter.action).toBe("VIEW");
    expect(filter.category).toEqual(expect.arrayContaining(["BROWSABLE", "DEFAULT"]));
    expect(filter.data.map((d: { scheme: string; host: string }) => `${d.scheme}://${d.host}`).sort()).toEqual(APP_LINK_HOSTS.map((host) => `https://${host}`).sort());
  });
});
