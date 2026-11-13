import { allowedIps } from "@krizaka/auth";
import { STORAGE_KIND, STORAGE_PROVIDERS } from "@verikora/core";
import { z } from "zod";

import { transferProblems, type TransferRegister } from "./privacy/transfers";
import { parseSigningKey } from "./report-key";

/**
 * Every environment variable of the app, declared once (named by bounded context — APP_, DATABASE_, AUTH_, ABUSE_, AI_ —
 * never by product or vendor: the vendor is a value, `AI_PROVIDER=sovkora`). A production server refuses to start
 * without its secrets (instrumentation.ts calls `assertProductionEnv`): no demo mode, no default key.
 */
const flag = z
  .string()
  .optional()
  .transform((v) => v?.trim().toLowerCase() === "true");
const list = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** `off` on every dev / preview deployment: noindex everywhere, robots `Disallow: /`, no sitemap, the dev line in the footer (lib/indexing.ts). */
  APP_SEARCH_INDEXING: z.enum(["on", "off"]).default("on"),
  /** Which environment this deployment is: a flow is enabled per environment (ADR-0003). */
  APP_ENVIRONMENT: z.enum(["dev", "prod"]).default("dev"),
  /** The backfill of ADR-0012: the bytes still in `documents.content` move to the store (`on`), are only counted (`dry-run`), or stay (`off`). */
  APP_DOCUMENTS_BACKFILL: z.enum(["on", "dry-run", "off"]).default("on"),
  /** Dev and visual runs only: the instant the console writes as « today », so a capture never depends on the day it is taken (lib/display-now.ts). Refused in production. */
  APP_VISUAL_NOW: z.string().datetime().optional(),
  /** The public origin of the site (canonical URLs, sitemap, llms.txt). */
  APP_PUBLIC_URL: z.string().url().default("https://www.verikora.com"),
  /** Optional credentials for the dev/local demo persona seed. */
  APP_DEMO_ACCOUNT_EMAIL: z.string().optional(),
  APP_DEMO_ACCOUNT_PASSWORD: z.string().optional(),
  /** The development address (`dev.verikora.com`): every page goes to www (308); only the API, auth callbacks, webhooks, /.well-known and /healthz keep serving there, all noindex (lib/indexing.ts). Unset: no dev host. */
  APP_DEV_HOST: z.string().optional(),
  /** The Apple team that signs the iOS app: the prefix of its app id in `/.well-known/apple-app-site-association` (universal links, verikora#155). Unset: that file is not served. */
  APP_IOS_TEAM_ID: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
  /** The SHA-256 fingerprint(s) of the Android app's signing certificate, comma-separated (`AB:CD:…`): `/.well-known/assetlinks.json`. Unset: that file is not served. */
  APP_ANDROID_CERT_SHA256: z.string().optional(),
  /** PostgreSQL (the cluster krizaka-dev-pg in dev: database verikora_db, role verikora_db). */
  DATABASE_URL: z.string().optional(),
  /** The same database reached directly, not through the PgBouncer pool (`pool-verikora`): session advisory locks (migrations, ticks) need one backend for their whole life. Unset: DATABASE_URL. */
  DATABASE_DIRECT_URL: z.string().optional(),
  /** Connections the app keeps open on DATABASE_URL (the pool's size; the lock pool keeps its own 4). */
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(5),
  /** The cluster's CA (PEM), to verify its certificate; without it a TLS URL is refused in production. */
  DATABASE_CA_CERT: z.string().optional(),
  /** Keys the session tokens' hashes (≥ 32 characters). */
  AUTH_SESSION_SECRET: z.string().optional(),
  /** Sign-up is closed unless this is `true` (closed on every dev deployment: QA accounts only). */
  AUTH_SIGNUP_ENABLED: flag,
  /** Outgoing e-mail (the verification link). The vendor is a value: `MAIL_PROVIDER=mailgun`. Without all three, sign-up stays closed. */
  MAIL_PROVIDER: z.enum(["mailgun"]).optional(),
  MAIL_API_KEY: z.string().optional(),
  MAIL_DOMAIN: z.string().optional(),
  MAIL_API_URL: z.string().url().default("https://api.mailgun.net"),
  MAIL_FROM: z.string().optional(),
  /** The key the provider signs its bounce and complaint webhooks with (`/api/webhooks/mail`). Unset: that route answers 404. */
  MAIL_WEBHOOK_SIGNING_KEY: z.string().optional(),
  /** Payments: the vendor is a value (`stripe`); the key's prefix decides test or live. Without provider, key and webhook secret, payments are off. */
  PAYMENTS_PROVIDER: z.enum(["stripe"]).optional(),
  PAYMENTS_STRIPE_SECRET_KEY: z.string().optional(),
  PAYMENTS_STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** The processor's price lookup keys: prices are data at the processor, never typed here. */
  /** The Pro plan's fair-use cap, audits per calendar month. */
  /** What one engine run costs, in cents — an ESTIMATE the pre-flight's metrics multiply by the runs it avoided. */
  APP_ESTIMATED_RUN_COST_CENTS: z.coerce.number().int().min(0).default(3),
  /** The addresses that may open the administration (comma-separated). Empty in production = nobody. */
  AUTH_ALLOWED_IPS: list,
  /** A header the edge sets with the client's address (`do-connecting-ip` on App Platform). */
  ABUSE_CLIENT_IP_HEADER: z.string().optional(),
  ABUSE_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
  /** Signs the audit reports (Ed25519, base64 of the PKCS#8 DER — `node scripts/generate-report-key.mjs`), a DO SECRET. */
  APP_REPORT_SIGNING_KEY: z.string().optional(),
  /** Where a kept document lives (ADR-0007): nothing kept by default; `bunny` is for development and fictional data only (no Canadian region); `s3` is Spaces tor1, a workspace's own bucket or a local test server. */
  MEDIA_DOCUMENTS_PROVIDER: z.enum(STORAGE_PROVIDERS).default(STORAGE_KIND.none),
  /** A document that is not kept is purged after its check; one that is never checked, after this many hours. */
  APP_PURGE_AFTER_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /** Seals the credentials of a workspace's own S3 in the database (AES-256-GCM, 32 bytes in base64); without it, storing credentials is unavailable. */
  APP_SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  /** The key-encryption key of the storage providers (ADR-005): 32 bytes in base64, a DO SECRET. The admin's providers and their credentials live in the database, sealed under it; it is the only storage variable the deployment needs. */
  MEDIA_VAULT_KEY: z.string().optional(),
  /** The app registrations at the clouds a person may connect (verikora#530; each needs its redirect address `APP_PUBLIC_URL/api/me/storage/cloud/callback`). A cloud without its client id is not offered. */
  MEDIA_CLOUD_DROPBOX_CLIENT_ID: z.string().optional(),
  MEDIA_CLOUD_DROPBOX_CLIENT_SECRET: z.string().optional(),
  MEDIA_CLOUD_GOOGLE_CLIENT_ID: z.string().optional(),
  MEDIA_CLOUD_GOOGLE_CLIENT_SECRET: z.string().optional(),
  MEDIA_CLOUD_MICROSOFT_CLIENT_ID: z.string().optional(),
  MEDIA_CLOUD_MICROSOFT_CLIENT_SECRET: z.string().optional(),
  /** The `MEDIA_DOCUMENTS_*`, `MEDIA_STORAGE_*` and `MEDIA_S3_*` values below only bootstrap: read once to import the provider a deployment already used (`bootstrapFromEnvironment`), never to choose a store afterwards. */
  MEDIA_DOCUMENTS_PREFIX: z.string().default("verikora"),
  /** AES-256-GCM key (32 bytes, base64) that encrypts every kept document before it leaves; the provider only holds ciphertext. */
  MEDIA_DOCUMENTS_ENCRYPTION_KEY: z.string().optional(),
  MEDIA_STORAGE_ENDPOINT: z.string().default("storage.bunnycdn.com"),
  MEDIA_STORAGE_ZONE: z.string().optional(),
  MEDIA_STORAGE_API_KEY: z.string().optional(),
  /** The zone's pull zone (token authentication) and its key: with both, the store hands out signed, expiring links. */
  MEDIA_DOCUMENTS_PULL_HOSTNAME: z.string().optional(),
  MEDIA_DOCUMENTS_TOKEN_KEY: z.string().optional(),
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_REGION: z.string().optional(),
  MEDIA_S3_BUCKET: z.string().optional(),
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Where the analyses run: Sovkora, and only Sovkora. */
  AI_PROVIDER: z.literal("sovkora").default("sovkora"),
  /** Sovkora's edge (`https://dev.sovkora.com/edge`). */
  AI_API_URL: z.string().url().default("https://dev.sovkora.com/edge"),
  /** Verikora's `oz_` service key (Sovkora `dev-deploy.mjs service-account verikora`), a DO SECRET. */
  AI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Which environment this deployment is: read at the edges (pages, routes) and passed to lib/flows.ts. */
export const appEnvironment = () => readEnv().APP_ENVIRONMENT;

/** The instant a dev visual run froze as « today » (undefined: the real clock). */
export const appVisualNow = () => readEnv().APP_VISUAL_NOW;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}

/** What a production server cannot run without — named, never shown. */
export function productionProblems(env: Env, register?: TransferRegister): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }
  const problems: string[] = [];
  if (!env.DATABASE_URL) {
    problems.push("DATABASE_URL is not set");
  }
  if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < 32) {
    problems.push("AUTH_SESSION_SECRET must be at least 32 characters");
  }
  if (!env.AI_API_KEY?.startsWith("oz_")) {
    problems.push("AI_API_KEY must be an Sovkora key (oz_…)");
  }
  if (!env.APP_REPORT_SIGNING_KEY) {
    problems.push("APP_REPORT_SIGNING_KEY is not set");
  } else {
    try {
      parseSigningKey(env.APP_REPORT_SIGNING_KEY);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  if (env.APP_ENVIRONMENT === "prod" && env.MEDIA_DOCUMENTS_PROVIDER === STORAGE_KIND.bunny) {
    problems.push("MEDIA_DOCUMENTS_PROVIDER=bunny has no Canadian region: development and fictional data only");
  }
  if (env.APP_ENVIRONMENT === "prod" && env.APP_VISUAL_NOW) {
    problems.push("APP_VISUAL_NOW freezes the date the console shows: dev and visual runs only");
  }
  if (env.DATABASE_URL && /sslmode=(require|verify)/.test(env.DATABASE_URL) && !env.DATABASE_CA_CERT) {
    problems.push("DATABASE_CA_CERT is required for a TLS database");
  }
  if (env.APP_ENVIRONMENT === "prod") {
    problems.push(...transferProblems(register));
  }
  return problems;
}

export function assertProductionEnv(
  source: Record<string, string | undefined> = process.env,
  register?: TransferRegister,
): void {
  const problems = productionProblems(readEnv(source), register);
  if (problems.length) {
    throw new Error(`Verikora refuses to start: ${problems.join("; ")}`);
  }
}

export const env = () => readEnv();
/** The administration's allow-list; `null` = no restriction (development only). */
export function consoleAllowedIps(source: Record<string, string | undefined> = process.env): readonly string[] | null {
  const e = readEnv(source);
  return allowedIps(e.AUTH_ALLOWED_IPS, { production: e.NODE_ENV === "production" });
}

const DEV_SECRET = "development-only-session-secret-not-for-production";
export function sessionSecret(): string {
  const e = env();
  if (e.AUTH_SESSION_SECRET) {
    return e.AUTH_SESSION_SECRET;
  }
  if (e.NODE_ENV === "production") {
    throw new Error("AUTH_SESSION_SECRET is not set");
  }
  return DEV_SECRET;
}
