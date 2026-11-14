import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

const spec = readFileSync(join(__dirname, "../../../deploy/digitalocean/dev.app.yaml"), "utf8");

type Declared = { secret: boolean; value: string | undefined };

/** The `key:` entries of the `web` service's `envs` (the text before `jobs:`), with their `type` and `value` (flow-style entries, as written in the spec). */
function declared(): Map<string, Declared> {
  const out = new Map<string, Declared>();
  const web = spec.split(/^jobs:/m)[0]!;
  for (const m of web.matchAll(/^\s*- \{\s*key:\s*([A-Z0-9_]+),([^\n]*)\}\s*$/gm)) {
    out.set(m[1]!, { secret: /type:\s*SECRET/.test(m[2]!), value: /value:\s*"?([^",}\s]*)"?/.exec(m[2]!)?.[1] });
  }
  // The multi-line form Prettier gives a long entry: `- {\n key: NAME,\n scope: …,\n type: SECRET,\n value: …,\n }`.
  for (const m of web.matchAll(/^\s*- \{\s*\n((?:\s+\w+:[^\n]*\n)+)\s*\}/gm)) {
    const body = m[1]!;
    const key = /key:\s*([A-Z0-9_]+)/.exec(body)?.[1];
    if (key) {
      out.set(key, { secret: /type:\s*SECRET/.test(body), value: /value:\s*"?([^",\s]*)"?/.exec(body)?.[1] });
    }
  }
  return out;
}

/**
 * Keys the app reads (`envSchema`) that the dev spec deliberately does not declare, each with its reason. A key is declared in the spec
 * unless it is here: adding a variable to `env.ts` without declaring it (or justifying it here) fails this test (krizaka-internal#3502).
 */
const NOT_DECLARED: Record<string, string> = {
  NODE_ENV: "set by the Dockerfile (production); never a spec value",
  APP_VISUAL_NOW: "visual runs only (a frozen clock); refused in production, must never sit in the live spec",
  APP_DOCUMENTS_BACKFILL: "has a default (on): the ADR-0012 backfill runs unless turned off",
  APP_DEMO_ACCOUNT_EMAIL: "optional: the local demo persona seed only",
  APP_DEMO_ACCOUNT_PASSWORD: "optional: the local demo persona seed only",
  APP_DEV_HOST: "optional: the dev spec's primary is dev.verikora.com itself, so no host is redirected to www",
  APP_IOS_TEAM_ID: "optional: unset = apple-app-site-association is not served (no iOS app on dev yet)",
  APP_ANDROID_CERT_SHA256: "optional: unset = assetlinks.json is not served (no Android app on dev yet)",
  APP_ESTIMATED_RUN_COST_CENTS: "has a default (3): an estimate for the pre-flight's metrics",
  APP_PURGE_AFTER_HOURS: "has a default (24 hours)",
  APP_SETTINGS_ENCRYPTION_KEY:
    "optional: without it a workspace's own S3 credentials cannot be stored; the vault key is the way (ADR-005)",
  ABUSE_TRUSTED_PROXY_HOPS: "has a default (1), right for App Platform",
  MAIL_PROVIDER: "mail is off on dev: sign-up stays closed; declared the day it is turned on",
  MAIL_API_KEY: "mail is off on dev; see MAIL_PROVIDER",
  MAIL_DOMAIN: "mail is off on dev; see MAIL_PROVIDER",
  MAIL_API_URL: "has a default (Mailgun US); only with MAIL_PROVIDER",
  MAIL_FROM: "mail is off on dev; see MAIL_PROVIDER",
  MAIL_WEBHOOK_SIGNING_KEY: "optional: unset = the webhook route answers 404; mail is off on dev",
  MEDIA_CLOUD_DROPBOX_CLIENT_ID: "optional: a cloud without its client id is not offered (verikora#530)",
  MEDIA_CLOUD_DROPBOX_CLIENT_SECRET: "optional: see MEDIA_CLOUD_DROPBOX_CLIENT_ID",
  MEDIA_CLOUD_GOOGLE_CLIENT_ID: "optional: a cloud without its client id is not offered (verikora#530)",
  MEDIA_CLOUD_GOOGLE_CLIENT_SECRET: "optional: see MEDIA_CLOUD_GOOGLE_CLIENT_ID",
  MEDIA_CLOUD_MICROSOFT_CLIENT_ID: "optional: a cloud without its client id is not offered (verikora#530)",
  MEDIA_CLOUD_MICROSOFT_CLIENT_SECRET: "optional: see MEDIA_CLOUD_MICROSOFT_CLIENT_ID",
  MEDIA_DOCUMENTS_PREFIX: "has a default (verikora): the object-key prefix",
  MEDIA_DOCUMENTS_ENCRYPTION_KEY:
    "optional: bootstrap of an already-used provider only; the vault key seals what is stored now",
  MEDIA_S3_ENDPOINT: "optional: bootstrap of an S3 provider only; dev uses bunny",
  MEDIA_S3_REGION: "optional: see MEDIA_S3_ENDPOINT",
  MEDIA_S3_BUCKET: "optional: see MEDIA_S3_ENDPOINT",
  MEDIA_S3_ACCESS_KEY_ID: "optional: see MEDIA_S3_ENDPOINT",
  MEDIA_S3_SECRET_ACCESS_KEY: "optional: see MEDIA_S3_ENDPOINT",
};

describe("the dev app spec declares every variable the app reads (krizaka-internal#3502)", () => {
  const specKeys = declared();
  const schemaKeys = Object.keys(envSchema.shape);

  it("reads the spec: the web service's keys are found", () => {
    expect(specKeys.has("DATABASE_URL")).toBe(true);
    expect(specKeys.has("PAYMENTS_STRIPE_WEBHOOK_SECRET")).toBe(true);
    expect(specKeys.has("BACKUP_AGE_RECIPIENT"), "the jobs' keys are not the web service's").toBe(false);
  });

  it("declares every key of the env schema, or justifies it in NOT_DECLARED", () => {
    const missing = schemaKeys.filter((k) => !specKeys.has(k) && !(k in NOT_DECLARED));
    expect(
      missing,
      "declare in deploy/digitalocean/dev.app.yaml (secrets as type: SECRET, value __NAME__), or justify in NOT_DECLARED",
    ).toEqual([]);
  });

  it("keeps the allow-list honest: a real schema key, not declared, with a reason", () => {
    for (const [key, reason] of Object.entries(NOT_DECLARED)) {
      expect(schemaKeys, `${key} is not in the env schema any more: remove it from NOT_DECLARED`).toContain(key);
      expect(specKeys.has(key), `${key} is declared in the spec: remove it from NOT_DECLARED`).toBe(false);
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(10);
    }
  });

  it("holds no secret value in git: a SECRET is a __NAME__ placeholder", () => {
    for (const [key, { secret, value }] of specKeys) {
      if (secret) {
        expect(value, `${key} is a SECRET: its value is the placeholder`).toBe(`__${key}__`);
      }
    }
  });

  it("declares the vault key as a SECRET", () => {
    expect(specKeys.get("MEDIA_VAULT_KEY")?.secret).toBe(true);
  });
});
