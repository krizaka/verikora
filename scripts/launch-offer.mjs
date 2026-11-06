#!/usr/bin/env node
// The launch offer of ADR-0013 (amendment 2026-10-29, verikora#548), created through the DOCUMENTED path: the administration's own API,
// signed in as the seeded administrator persona (Mira). Never SQL. Idempotent: a coupon with the code is kept, the setting is set again.
//
//   node scripts/launch-offer.mjs --base https://admin.verikora.com        (dev: from an address of AUTH_ALLOWED_IPS)
//   node scripts/launch-offer.mjs --base http://admin.localhost:3000       (local, after `pnpm dev:seed`)
//
// The credentials are the cast's administrator: QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD (or APP_DEMO_ADMIN_*), read from the environment,
// never printed. Production is the founder's: this script refuses a base that is not dev or a local host.
//
// The offer: code LANCEMENT, -50 % for 3 months on Agence and Gestionnaire, once per account, ending 3 months after today.
import { pathToFileURL } from "node:url";

export const OFFER = {
  code: "LANCEMENT",
  percentOffBp: 5000,
  durationMonths: 3,
  plans: ["agency", "firm"],
  endsInMonths: 3,
};

/** `date` plus `months` calendar months, in UTC (the 31st of a short month lands on its last day). */
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The body of POST /api/admin/coupons for the offer, starting now. */
export function offerBody(now) {
  return {
    code: OFFER.code,
    kind: "discount",
    purpose: "promo",
    startsAt: now.toISOString(),
    endsAt: addMonths(now, OFFER.endsInMonths).toISOString(),
    percentOffBp: OFFER.percentOffBp,
    duration: "repeating",
    durationMonths: OFFER.durationMonths,
    plans: OFFER.plans,
    maxPerAccount: 1,
  };
}

/** Only dev and a local host: the production offer is created by the founder in the console. */
export function assertNotProductionBase(base) {
  const host = new URL(base).hostname;
  const local = ["localhost", "127.0.0.1", "admin.localhost"].includes(host) || host.endsWith(".localhost");
  if (!local && !/(^|\.)dev\./.test(host) && !host.startsWith("admin.verikora."))
    throw new Error(`refused: ${host} is not dev or local`);
  if (host === "verikora.com" || host === "www.verikora.com")
    throw new Error("refused: production belongs to the founder");
}

async function call(base, token, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

export async function run({ base, email, password, now = new Date() }) {
  assertNotProductionBase(base);
  const signIn = await fetch(`${base}/api/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, client: "native" }),
  });
  if (!signIn.ok) throw new Error(`sign-in -> ${signIn.status} (an address of AUTH_ALLOWED_IPS is needed)`);
  const { token } = await signIn.json();
  const list = await call(base, token, "/api/admin/coupons?limit=200");
  const existing = (list.coupons?.items ?? list.coupons ?? []).find?.((c) => c.code?.toUpperCase() === OFFER.code);
  const created = existing
    ? null
    : await call(base, token, "/api/admin/coupons", { method: "POST", body: JSON.stringify(offerBody(now)) });
  console.log(
    existing
      ? `coupon ${OFFER.code}: already there`
      : `coupon ${OFFER.code}: created, ends ${created.coupon.endsAt ?? "?"}`,
  );
  try {
    await call(base, token, "/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({ scope: "global", key: "pricing.announcedCode", value: OFFER.code }),
    });
    console.log(`setting pricing.announcedCode = ${OFFER.code}`);
  } catch {
    console.log(
      `setting pricing.announcedCode NOT set — the app must run the build that declares it (#550); run this again`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--base");
  const base = i >= 0 ? process.argv[i + 1] : "";
  const email = process.env.QA_ADMIN_EMAIL ?? process.env.APP_DEMO_ADMIN_EMAIL;
  const password = process.env.QA_ADMIN_PASSWORD ?? process.env.APP_DEMO_ADMIN_PASSWORD;
  if (!base || !email || !password)
    throw new Error("usage: QA_ADMIN_EMAIL=… QA_ADMIN_PASSWORD=… node scripts/launch-offer.mjs --base <admin url>");
  await run({ base, email, password });
}
