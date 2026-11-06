// The demo data set of a persona (krizaka/verikora#274): an account, its collections, its fictitious documents and a few finished checks.
// Idempotent (a re-run changes nothing; `reset` starts over) and refused on production. The checks are SEEDED, not run: their run id
// starts with `seeded-` and their inputs say so — no paid run, no call to the engine.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { generateDocument, PERSONA_ERIC, AS_OF, DEFAULT_SEED } from "../demo-documents/index.mjs";
import { CAST_MEMBER, castAccounts, fingerprintOf } from "./cast.mjs";

/** Where the app keeps the bytes of documents on a laptop, in CI and in tests when it has no store (apps/web/lib/storage/local.ts): the seed writes the same folder. */
const workingFolder = () => join(tmpdir(), "verikora-documents");
async function putBytes(key, bytes) {
  const path = join(workingFolder(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

/** The side Éric works on: a property manager (`accounts.perspective`). The cast defines it, so a re-run brings it back (krizaka-internal#2289). */
const SIDE_LANDLORD = "landlord";

/** The persona's name comes from the cast; this file adds what the cast does not hold: the collections and documents. */
export const PERSONAS = {
  [CAST_MEMBER.id]: { ...PERSONA_ERIC, key: CAST_MEMBER.id, name: CAST_MEMBER.displayName, perspective: SIDE_LANDLORD },
};
export const DEFAULT_EMAILS = { [CAST_MEMBER.id]: `${CAST_MEMBER.id}@demo.verikora.test` };
/**
 * What the tenant-shield rules (Section G, payment clauses, verikora#104) give on the demo leases' figures, one list per document: the findings
 * as the app writes them, kept as data because the rules are TypeScript and the seed is not. Generated from the rules and guarded by
 * `apps/web/lib/rules/tenant-shield-fixture.test.ts` (it fails on a drift and says how to regenerate), never typed by hand.
 */
const TENANT_SHIELD = JSON.parse(readFileSync(new URL("./tenant-shield.json", import.meta.url), "utf8"));
export const SEEDED_RUN_PREFIX = "seeded-";
/** What a seeded check carries in its inputs — the same marker `@verikora/core` reads (`isSeededCheck`). */
export const SEEDED_INPUTS = { seeded: "true" };

/** The demo tokens of the owner link of a persona's seeded file (verikora#128): one that opens, one that was revoked. Demo values, never a real link. */
export const demoOwnerTokens = (persona) => ({
  live: `demo-owner-live-${persona}-0123456789abcdef`,
  revoked: `demo-owner-revoked-${persona}-0123456789abcdef`,
});
/** The document of the seeded applicant file: a pay stub whose total is wrong (one of the checked documents of the persona). */
const APPLICANT_FILE_DOCUMENT = { id: "paie-villeray-2-totaux-faux", type: "pay-stub" };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** A fictitious applicant file with its two owner links, so the public report page can be audited (idempotent: the links are renewed). The tokens are fixed, so the seed that ran last owns them: two seeds in one database (tests, the cast) never leave the file with the wrong landlord. */
async function seedOwnerFile(q, owner, persona, seed) {
  const [file] = await q(
    `INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, flow, requested_types)
     VALUES ($1, 'Camille Fictif', 'camille@demo.verikora.test', '{}', 'applicant-file', $2, now() + interval '30 days', 'file', $3)
     ON CONFLICT (token_hash) DO UPDATE SET landlord_id = EXCLUDED.landlord_id, expires_at = EXCLUDED.expires_at, requested_types = EXCLUDED.requested_types RETURNING id`,
    [owner, sha256(`demo-file-${persona}`), [APPLICANT_FILE_DOCUMENT.type]],
  );
  // The applicant's pay stub, whose total does not add up, is the file's one document and carries its seeded check: « Dossiers »
  // opens a file, the file leads to a report (krizaka-internal#2289, the journey `applicant-file-open`). It stays in the collection
  // « Candidats » too: the same document, seen from the file.
  const stub = await generateDocument(APPLICANT_FILE_DOCUMENT.id, seed);
  await q(
    `UPDATE documents SET screening_id = $3, document_type = $4, retention_policy = 'after-decision' WHERE owner_id = $1 AND sha256 = $2`,
    [owner, stub.sha256, file.id, APPLICANT_FILE_DOCUMENT.type],
  );
  const tokens = demoOwnerTokens(persona);
  for (const [name, revoked] of [
    ["live", false],
    ["revoked", true],
  ]) {
    await q(
      `INSERT INTO file_report_shares (screening_id, landlord_id, recipient, token_hash, expires_at, revoked_at)
       VALUES ($1, $2, 'Demo', $3, now() + interval '30 days', ${revoked ? "now()" : "NULL"})
       ON CONFLICT (token_hash) DO UPDATE SET screening_id = EXCLUDED.screening_id, landlord_id = EXCLUDED.landlord_id, expires_at = EXCLUDED.expires_at, revoked_at = ${revoked ? "coalesce(file_report_shares.revoked_at, now())" : "NULL"}`,
      [file.id, owner, sha256(tokens[name])],
    );
  }
}

/** The seed works on dev and local only: anything that says it is production is refused, and so is a value it does not know. */
export function assertNotProduction(env) {
  const environment = env.APP_ENVIRONMENT ?? "dev";
  if (environment !== "dev")
    throw new Error(`demo:seed works only on dev and local, and APP_ENVIRONMENT is "${environment}" — refused`);
}

/** The words of the persona (collection names and descriptions) in a language, from the app's messages. */
export function collectionWords(messages, personaKey, collectionKey) {
  const entry = messages?.demo?.[personaKey]?.collections?.[collectionKey];
  if (!entry?.name) throw new Error(`messages: demo.${personaKey}.collections.${collectionKey}.name is missing`);
  return { name: entry.name, description: entry.description ?? null };
}

const COMPLIANCE_SOURCE = "Jeu de données de démonstration — résultat marqué comme semé, aucun appel au moteur";

/** A finished check's report, in the shape the two Studios return, built from the findings recorded next to the document. */
export function seededReport(doc) {
  if (doc.family === "lease") {
    const failed = doc.findings.map((f) => ({
      ruleId: f.code,
      title: f.title,
      severity: f.severity,
      verdict: "FAIL",
      explanation: f.explanation,
      method: "SEEDED",
      ...(f.present?.[0] ? { evidenceSpan: { quote: f.present[0] } } : {}),
    }));
    const passed =
      failed.length === 0
        ? [
            {
              ruleId: "DEMO-LEASE-OK",
              title: "Aucun écart relevé",
              severity: "INFO",
              verdict: "PASS",
              explanation: "Le bail du jeu de données ne présente aucun des écarts recherchés.",
              method: "SEEDED",
            },
          ]
        : [];
    const findings = [...failed, ...passed, ...(TENANT_SHIELD[doc.id] ?? [])];
    const byVerdict = {};
    for (const f of findings) byVerdict[f.verdict] = (byVerdict[f.verdict] ?? 0) + 1;
    return {
      rulesetId: "demo-seeded",
      rulesetVersion: "1",
      jurisdiction: "QC",
      asOf: AS_OF,
      source: COMPLIANCE_SOURCE,
      reviewStatus: "TO_REVIEW_BY_LAWYER",
      summary: { byVerdict, blockingFailures: failed.length, rulesEvaluated: findings.length },
      findings,
      ...(doc.facts ? { facts: doc.facts } : {}),
    };
  }
  return {
    header: COMPLIANCE_SOURCE,
    pages: doc.pages,
    signals: doc.findings.map((f) => ({
      signalId: f.code,
      level: "incohérent",
      observation: f.explanation,
      where: f.present?.[0],
    })),
    notExamined: ["Authenticité de l'émetteur (jeu de données fictif)"],
  };
}

const searchTextOf = (report) =>
  "findings" in report
    ? report.findings.flatMap((f) => [f.ruleId, f.title, f.explanation, f.evidenceSpan?.quote ?? ""]).join("\n")
    : report.signals.flatMap((s) => [s.signalId, s.observation, s.where ?? ""]).join("\n");
const needsAttention = (report) =>
  "findings" in report
    ? report.findings.some((f) => f.verdict === "FAIL" && f.severity === "BLOCKING")
    : report.signals.some((s) => s.level === "incohérent");

/**
 * Seeds the persona into the database behind `q` (`(sql, values) => Promise<rows>`, ONE connection: the seed is one transaction).
 * `messagesByLocale` holds the app's catalogues: the collections take the account's language. One seed at a time per account:
 * a second process waits on the account's advisory lock, then finds everything already there (idempotent). Returns what is
 * there after the run.
 */
export async function seedPersona(
  q,
  {
    persona = "eric",
    email,
    locale = "fr",
    messagesByLocale,
    reset = false,
    passwordHash = null,
    seed = DEFAULT_SEED,
    now = new Date(),
  },
) {
  const def = PERSONAS[persona];
  if (!def) throw new Error(`unknown persona "${persona}" (known: ${Object.keys(PERSONAS).join(", ")})`);
  const address = (email ?? DEFAULT_EMAILS[persona]).trim().toLowerCase();
  await q("BEGIN");
  try {
    await q("SELECT pg_advisory_xact_lock(hashtext($1))", [`demo-seed:${address}`]);
    const result = await seedInTransaction(q, def, {
      persona,
      address,
      locale,
      messagesByLocale,
      reset,
      passwordHash,
      seed,
      now,
    });
    await q("COMMIT");
    return result;
  } catch (error) {
    // The rollback never masks what went wrong.
    await q("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** The instant `minutesAgo` before the injected clock: every stamp the seed writes comes from `now`, never from the database's own clock. */
export const stampBefore = (now, minutesAgo) => new Date(new Date(now).getTime() - minutesAgo * 60_000).toISOString();

/** A reset starts the demo over: the owner's documents go, and so do the collections the seed made (in every language they were named). */
async function resetDemo(q, { owner, def, persona, messagesByLocale }) {
  await q("DELETE FROM documents WHERE owner_id = $1", [owner]);
  const names = def.collections.flatMap((c) =>
    Object.values(messagesByLocale).map((m) => collectionWords(m, persona, c.key).name),
  );
  await q("DELETE FROM collections WHERE owner_id = $1 AND NOT is_default AND name = ANY($2)", [owner, names]);
}

/** A check that did not finish, seeded for the documents `def.failed` names, so its page can say why and offer a way out (krizaka-internal#1900). Returns the stamps it used (0 or 1). */
async function seedFailedCheck(q, { def, id, documentId, now, ago }) {
  const failed = (def.failed ?? []).find((f) => f.id === id);
  if (!failed) return 0;
  await q(
    `INSERT INTO analyses (document_id, studio, status, run_id, blueprint_version, inputs, report, error, search_text, created_at, finished_at)
     SELECT $1, $2, 'failed', $3, NULL, $4, NULL, $5, '', $6::timestamptz, $6::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM analyses WHERE document_id = $1 AND run_id = $3)`,
    [
      documentId,
      failed.studio,
      `${SEEDED_RUN_PREFIX}failed-${id}`,
      JSON.stringify(SEEDED_INPUTS),
      failed.error,
      stampBefore(now, ago),
    ],
  );
  return 1;
}

async function seedInTransaction(
  q,
  def,
  { persona, address, locale, messagesByLocale, reset, passwordHash, seed, now },
) {
  // An existing account keeps what the person chose (language, name); the seed only fills what is missing. The persona's side is the cast's:
  // Éric is a property manager, and on the shared dev database he had been left on « tenant » (the applicant files answered 404 on www),
  // so a re-run puts the side back (krizaka-internal#2289).
  // A reset starts the demo over: it takes the language asked for, or the English films were made on French fixtures (verikora#1968).
  const [account] = await q(
    `INSERT INTO accounts (email, locale, email_verified_at, password_hash, perspective, name) VALUES ($1, $2, now(), $3, $6, $4)
     ON CONFLICT (email) DO UPDATE SET locale = CASE WHEN $5::boolean THEN EXCLUDED.locale ELSE accounts.locale END, password_hash = coalesce(EXCLUDED.password_hash, accounts.password_hash),
       perspective = EXCLUDED.perspective, name = coalesce(accounts.name, EXCLUDED.name)
     RETURNING id, locale, name`,
    [address, locale, passwordHash, def.name, reset, def.perspective],
  );
  const owner = account.id;
  const words = (key) => collectionWords(messagesByLocale[account.locale] ?? messagesByLocale.fr, persona, key);

  if (reset) await resetDemo(q, { owner, def, persona, messagesByLocale });

  const [library] = await q("SELECT id FROM libraries WHERE owner_id = $1 ORDER BY created_at, id LIMIT 1", [owner]);
  const counts = {};
  // Each document and its report are stamped one minute apart, counted back from the injected clock `now`: the dates the lists write
  // are the same on every run and every day, and a list ordered by date never has a tie (verikora#641).
  const total = def.collections.reduce((n, c) => n + c.documents.length, 0);
  let minute = 0;
  let documentIndex = 0;
  for (const collection of def.collections) {
    const { name, description } = words(collection.key);
    const [row] = await q(
      `INSERT INTO collections (library_id, owner_id, name, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (library_id, name) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
      [library.id, owner, name, description],
    );
    for (const id of collection.documents) {
      const doc = await generateDocument(id, seed);
      // The bytes go to the working store (a folder here), the row only names them (ADR-0012): the same shape the upload writes.
      const docId = randomUUID();
      const key = `${owner}/${docId}/original.pdf`;
      const inserted = await q(
        `INSERT INTO documents (id, owner_id, title, filename, mime_type, kind, size_bytes, sha256, pages, content, object_key, text, collection_id, created_at)
         VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7, $8, ''::bytea, $9, $10, $11, $12) ON CONFLICT (owner_id, sha256) DO NOTHING RETURNING id`,
        [
          docId,
          owner,
          doc.title,
          doc.filename,
          doc.kind,
          doc.bytes.length,
          doc.sha256,
          doc.pages,
          key,
          doc.text,
          row.id,
          stampBefore(now, total - documentIndex++),
        ],
      );
      if (inserted.length > 0) await putBytes(key, doc.bytes);
      const [stored] = await q("SELECT id FROM documents WHERE owner_id = $1 AND sha256 = $2", [owner, doc.sha256]);
      if (def.checked.includes(id)) {
        const report = seededReport(doc);
        const studio = doc.family === "lease" ? "compliance-check" : "document-authenticity";
        const runId = `${SEEDED_RUN_PREFIX}${id}`;
        await q(
          `INSERT INTO analyses (document_id, studio, status, run_id, blueprint_version, inputs, report, search_text, created_at, finished_at)
           SELECT $1, $2, 'succeeded', $3, NULL, $4, $5, $6, $7::timestamptz, $7::timestamptz
            WHERE NOT EXISTS (SELECT 1 FROM analyses WHERE document_id = $1 AND run_id = $3)`,
          [
            stored.id,
            studio,
            runId,
            JSON.stringify(SEEDED_INPUTS),
            JSON.stringify({ ...report, attention: needsAttention(report) }),
            searchTextOf(report),
            stampBefore(now, total - minute++),
          ],
        );
      }
      minute += await seedFailedCheck(q, { def, id, documentId: stored.id, now, ago: total - minute });
    }
    const [count] = await q("SELECT count(*)::int AS n FROM documents WHERE collection_id = $1", [row.id]);
    counts[name] = count.n;
  }
  await seedOwnerFile(q, owner, persona, seed);
  return { owner, email: address, name: account.name, collections: counts };
}

/**
 * `seed --cast`: the whole Verikora cast, the same on a laptop, a CI runner and the dev deployment. The member gets the demo data
 * set of `seedPersona`; the administrator gets an account named after its persona. Idempotent; the caller refuses production
 * (`assertNotProduction`) before it connects. Returns the fingerprint of what is there for the cast's accounts.
 */
export async function seedCast(
  q,
  { env, hashPassword, locale = undefined, messagesByLocale, reset = false, now = new Date() },
) {
  const [member, admin, camille] = castAccounts(env);
  const result = await seedPersona(q, {
    persona: member.persona.id,
    email: member.email,
    locale: locale ?? member.persona.locale,
    messagesByLocale,
    reset,
    passwordHash: await hashPassword(member.password),
    now,
  });
  // The other accounts keep the name the person chose; the role and the credentials follow the environment.
  const upsert = async (a) =>
    (
      await q(
        `INSERT INTO accounts (email, locale, email_verified_at, password_hash, perspective, name, role) VALUES ($1, $2, now(), $3, 'landlord', $4, $5)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', password_hash = EXCLUDED.password_hash, name = coalesce(accounts.name, EXCLUDED.name)
         RETURNING id`,
        [a.email, a.persona.locale, await hashPassword(a.password), a.persona.displayName, a.role],
      )
    )[0].id;
  const others = [await upsert(admin), await upsert(camille)];
  const print = await fingerprintOf(q, [result.owner, ...others]);
  return {
    ...print,
    member: result,
    admin: { email: admin.email, name: admin.persona.displayName },
    camille: { email: camille.email, name: camille.persona.displayName },
  };
}
