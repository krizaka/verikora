// The fixture of the « applicant-withdraw-erase » journey (krizaka-internal#3432): a fresh applicant file of Eric's, with a link the
// applicant can open (the raw token is known here, only its hash is stored) and one document already received (its bytes in the
// database: the journeys run without an engine, so the upload itself is not the subject). Rebuilt at each run.
import { createHash } from "node:crypto";

import pg from "pg";

import { pgClientOptions } from "../../scripts/pg-client-options.mjs";

const TOKEN = "journey-applicant-withdraw-erase-0123456789abcdef";

/** Opens a client on the CI database, or fails: a journey never runs on a stale state. */
export async function connect() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required: the applicant journey prepares and reads rows");
  const client = new pg.Client(pgClientOptions());
  await client.connect();
  return client;
}

/** Returns `{ id, token }`: the file's id and the raw token of the link. Names and bytes are fictitious. */
export async function prepareApplicantLink(email) {
  const client = await connect();
  try {
    const owner = (await client.query("SELECT id FROM accounts WHERE email = $1", [email])).rows[0]?.id;
    if (!owner) throw new Error("the seeded persona eric is not in the database");
    const hashed = createHash("sha256").update(TOKEN).digest("hex");
    const old = (await client.query("SELECT id FROM screenings WHERE token_hash = $1", [hashed])).rows[0];
    if (old) {
      await client.query("DELETE FROM deletion_receipts WHERE screening_id = $1", [old.id]);
      await client.query("DELETE FROM application_consents WHERE screening_id = $1", [old.id]);
      await client.query("DELETE FROM documents WHERE screening_id = $1", [old.id]);
      await client.query("DELETE FROM screenings WHERE id = $1", [old.id]);
    }
    const file = (
      await client.query(
        `INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, flow, requested_types)
         VALUES ($1, 'Noa Fictif', 'noa@demo.verikora.test', '{}', 'applicant-file', $2, now() + interval '14 days', 'file', '{pay-stub}') RETURNING id`,
        [owner, hashed],
      )
    ).rows[0];
    const bytes = Buffer.from("TALON DE PAIE FICTIF\nSalaire net : 1 900 $\n");
    await client.query(
      `INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text, storage, screening_id, document_type, retention_policy)
       VALUES ($1, 'Talon fictif', 'talon-noa.txt', 'text/plain', 'other', $2, $3, $4, 'Salaire net : 1 900 $', 'database', $5, 'pay-stub', 'after-decision')`,
      [owner, bytes.length, createHash("sha256").update(bytes).digest("hex"), bytes, file.id],
    );
    return { id: file.id, token: TOKEN };
  } finally {
    await client.end();
  }
}

/** What the database still holds of the file: the outcome the journey asserts (rows gone), not a page load. */
export async function heldOf(id) {
  const client = await connect();
  try {
    const count = async (sql) => Number((await client.query(sql, [id])).rows[0].n);
    return {
      documents: await count("SELECT count(*) AS n FROM documents WHERE screening_id = $1"),
      checks: await count("SELECT count(*) AS n FROM screening_checks WHERE screening_id = $1"),
      activeConsents: await count(
        "SELECT count(*) AS n FROM application_consents WHERE screening_id = $1 AND withdrawn_at IS NULL",
      ),
      receipts: await count("SELECT count(*) AS n FROM deletion_receipts WHERE screening_id = $1"),
      screening: (await client.query("SELECT status, tenant_name, tenant_email FROM screenings WHERE id = $1", [id]))
        .rows[0],
    };
  } finally {
    await client.end();
  }
}

/** The purposes the applicant has consented to and not withdrawn. */
export async function activePurposes(id) {
  const client = await connect();
  try {
    const rows = (
      await client.query(
        "SELECT purpose FROM application_consents WHERE screening_id = $1 AND withdrawn_at IS NULL ORDER BY purpose",
        [id],
      )
    ).rows;
    return rows.map((r) => r.purpose);
  } finally {
    await client.end();
  }
}
