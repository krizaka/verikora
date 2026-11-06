#!/usr/bin/env node
// MANUAL TOOL (ADR-026), run by a person; owner: verikora lane; listed in README.md « Manual tools »; the header below says how to run it.
// « Krizaka reviews its own documents with Verikora » — one narrated walkthrough on the real dev site, as the persona Éric
// (the studio's owner, never an administrator): the redacted invoice and service-contract templates are dropped in the
// library, checked against the Québec rulesets (qc-invoice, qc-service-contract) by real Sovkora runs, and the findings are read
// with their quoted passages. EN and FR, desktop and phone.
//
//   E2E_EMAIL=… E2E_PASSWORD=… E2E_DOCS=<dir with the three redacted .txt files> \
//     node scripts/record-krizaka-review.mjs <out-dir> [--device phone|desktop] [--locale en|fr] [--voice]
//
// The documents are REDACTED copies (no NEQ, address, bank or personal data), kept outside every repository. Credentials stay
// in the environment and are never printed. The waiting for Sovkora is sped up (said in the metadata); nothing else is cut.
import { createRequire } from "node:module";
import path from "node:path";

import { createTake } from "./lib/take.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const out = path.resolve(args[0] ?? "record-out");
const device = flag("device", "desktop");
const locale = flag("locale", "en") === "fr" ? "fr" : "en";
const voice = args.includes("--voice");
const BASE = (process.env.APP_BASE_URL ?? "https://www.verikora.com").replace(/\/$/, "");
const need = (n) => {
  if (!process.env[n]) throw new Error(`${n} is required`);
  return process.env[n];
};
const email = need("E2E_EMAIL");
const password = need("E2E_PASSWORD");
const docs = path.resolve(need("E2E_DOCS"));
const FILES = {
  invoice: "facture-modele-krizaka.txt",
  contract: "contrat-de-prestation-modele-krizaka.txt",
  folioviv: "facture-folioviv-krizaka.txt",
};

/** What is said at each beat (also the captions). Honest about what Verikora found and what it did not. */
export const WORDS = {
  intro: {
    en: "Éric runs Krizaka, a software studio in Montréal. Before Krizaka becomes Folioviv's first client, its own invoice and contract templates go through Verikora.",
    fr: "Éric dirige Krizaka, un studio de logiciel à Montréal. Avant que Krizaka devienne le premier client d'Folioviv, ses propres modèles de facture et de contrat passent par Verikora.",
  },
  drop: {
    en: "He drops two templates. They are redacted copies: no company number, address or bank detail leaves the company.",
    fr: "Il dépose deux modèles. Ce sont des copies caviardées : aucun numéro d'entreprise, adresse ou coordonnée bancaire ne sort de la société.",
  },
  invoice: {
    en: "Verikora keeps the invoice as sent and shows its text. Éric asks for the Québec invoice check.",
    fr: "Verikora garde la facture telle qu'envoyée et en montre le texte. Éric demande la vérification de facture québécoise.",
  },
  running: {
    en: "Every check is a traced run of Sovkora, the engine. Here the wait is sped up.",
    fr: "Chaque vérification est une exécution tracée d'Sovkora, le moteur. Ici, l'attente est accélérée.",
  },
  invoiceFindings: {
    en: "Eight rules, eight passed, each with the passage it relied on and the article behind it: the date, the GST and QST numbers, the total, the taxes, the payment terms.",
    fr: "Huit règles, huit réussies, chacune avec le passage retenu et l'article qui la fonde : la date, les numéros de TPS et de TVQ, le total, les taxes, les conditions de paiement.",
  },
  folioviv: {
    en: "Then the invoice Folioviv issues for Krizaka, as the text a PDF would give: a label on one line, its value on the next. It carries its payment terms and due date, and Verikora reads that layout too.",
    fr: "Puis la facture qu'Folioviv émet pour Krizaka, en texte comme le donnerait un PDF : un libellé sur une ligne, sa valeur sur la suivante. Elle porte ses conditions de paiement et son échéance, et Verikora lit aussi cette mise en page.",
  },
  foliovivFindings: {
    en: "Eight rules, eight passed: the date, the total and the taxes are found over their labels, and the payment terms are there.",
    fr: "Huit règles, huit réussies : la date, le total et les taxes sont retrouvés sous leurs libellés, et les conditions de paiement y sont.",
  },
  contract: {
    en: "Next, the service contract: interest, copyright and moral rights, and a signature.",
    fr: "Ensuite, le contrat de services : intérêt, droit d'auteur et droits moraux, et une signature.",
  },
  contractFindings: {
    en: "Four rules, four passed. The report says plainly what it does not cover: the Civil Code, to be reviewed by a lawyer.",
    fr: "Quatre règles, quatre réussies. Le rapport dit clairement ce qu'il ne couvre pas : le Code civil, à faire relire par un avocat.",
  },
  notes: {
    en: "What no rule reads, such as a late-interest rate stated two different ways, is written up for Éric in a review note. Verikora helps; it does not replace a lawyer.",
    fr: "Ce qu'aucune règle ne lit, comme un taux d'intérêt de retard énoncé de deux façons, est consigné pour Éric dans une note de revue. Verikora aide; il ne remplace pas un avocat.",
  },
  outro: {
    en: "The wording Krizaka just checked is what it will print from Folioviv.",
    fr: "Le texte que Krizaka vient de faire vérifier est celui qu'elle imprimera depuis Folioviv.",
  },
};
const VOICES = { en: "Samantha", fr: "Amélie" };

const VIEWPORT = device === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const T = {
  invoiceKind: /^(Invoice|Facture)$/,
  contractKind: /^(Contract|Contrat)$/,
};

const take = await createTake({
  chromium,
  base: BASE,
  viewport: VIEWPORT,
  scale: device === "phone" ? 2 : 1,
  locale,
  outDir: path.join(out, device),
  name: `verikora-review-${locale}`,
  mobile: device === "phone",
  words: WORDS,
  voices: VOICES,
});
const { page, context } = take;
const req = context.request;
const signIn = await req.post(`${BASE}/api/auth/sign-in`, { data: { email, password } });
if (!signIn.ok()) throw new Error(`sign-in refused (${signIn.status()})`);
await req.put(`${BASE}/api/me/perspective`, { data: { perspective: "freelancer" } });
// A clean library: only what this walkthrough keeps (Éric's own demo documents).
const listed = await req.get(`${BASE}/api/documents`);
if (listed.ok())
  for (const d of (await listed.json()).documents ?? (await listed.json()) ?? [])
    if (d?.id) await req.delete(`${BASE}/api/documents/${d.id}`);

const hold = (ms) => page.waitForTimeout(ms);
async function upload(kind, file) {
  await page.getByRole("radio", { name: kind }).click();
  await page.locator("input[type=file]").setInputFiles(path.join(docs, file));
  await page
    .locator('a[href*="/app/documents/"]')
    .filter({ hasText: file.replace(/\.txt$/, "").replace(/-/g, " ") })
    .first()
    .waitFor({ timeout: 30_000 });
  await hold(900);
}
async function openDoc(file) {
  await page
    .locator('a[href*="/app/documents/"]')
    .filter({ hasText: file.replace(/\.txt$/, "").replace(/-/g, " ") })
    .first()
    .click();
  await page.waitForURL(/\/app\/documents\//);
  await page.waitForLoadState("networkidle");
}
/** Runs the check and waits for Sovkora's report (its ruleset line appears with the findings). */
async function check(type, ruleset, announce = false) {
  const seen = (re) => (document.body.innerText.match(new RegExp(re, "g")) ?? []).length;
  const marker = JSON.stringify(`${ruleset} ·`);
  const before = await page.evaluate(`(${seen.toString()})(${marker})`);
  const form = page.locator("form[aria-label]").first();
  await form.scrollIntoViewIfNeeded();
  await form.locator("select").first().selectOption(type);
  await hold(1000);
  await form.locator('button[type="submit"]').click();
  if (announce) take.beat("running");
  const done = take.fast(8);
  await page.waitForFunction(
    ([re, n]) => (document.body.innerText.match(new RegExp(re, "g")) ?? []).length > n,
    [`${ruleset} ·`, before],
    { timeout: 240_000 },
  );
  done();
  if (announce) await take.speak("running");
  await hold(800);
}
async function readFindings() {
  const first = page.locator('[data-testid="finding-citation"]').first();
  if (await first.count()) {
    await first.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy({ top: -140, behavior: "smooth" }));
  }
  await hold(1500);
}

await page.goto(`${BASE}/${locale}/app`, { waitUntil: "networkidle" });
await take.start();
take.beat("intro");
await take.speak("intro");
take.beat("drop");
await upload(T.invoiceKind, FILES.invoice);
await upload(T.contractKind, FILES.contract);
await upload(T.invoiceKind, FILES.folioviv);
await take.speak("drop");
take.beat("invoice");
await openDoc(FILES.invoice);
await page.waitForFunction(() => document.body.innerText.includes("FACTURE"), null, { timeout: 30_000 });
await take.speak("invoice");
await check("invoice", "qc-invoice", true);
take.beat("invoiceFindings");
await readFindings();
await take.speak("invoiceFindings");
await page.goBack();
await page.waitForLoadState("networkidle");
take.beat("folioviv");
await openDoc(FILES.folioviv);
await page.waitForFunction(() => document.body.innerText.includes("Facture / Invoice"), null, { timeout: 30_000 });
await take.speak("folioviv");
await check("invoice", "qc-invoice");
take.beat("foliovivFindings");
await readFindings();
await take.speak("foliovivFindings");
await page.goBack();
await page.waitForLoadState("networkidle");
take.beat("contract");
await openDoc(FILES.contract);
await page.waitForFunction(() => document.body.innerText.includes("ARTICLE 1"), null, { timeout: 30_000 });
await take.speak("contract");
await check("contract", "qc-service-contract");
take.beat("contractFindings");
await readFindings();
await take.speak("contractFindings");
take.beat("notes");
await take.speak("notes");
take.beat("outro");
await take.speak("outro");
const meta = await take.finish({ voice });
process.stdout.write(
  `${device}/${locale}: ${meta.seconds} s, ${meta.activeCaptureFps} fps while moving, ${meta.calls.filter((c) => c.status >= 500).length} server errors\n`,
);
