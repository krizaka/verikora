// The fixture of the « deletion-receipt » journey (krizaka-internal#3381): a fresh applicant file of Eric's with one kept document
// (its bytes in the database), which the manager's decision purges. Rebuilt at each run: its old receipt and document go first.
import { createHash } from "node:crypto";

import pg from "pg";

/** Returns the id of the file. The bytes are a fictitious line of text; the name is a fictitious one. */
export async function prepareClosableFile(email) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required: the receipt journey prepares a file to close");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const owner = (await client.query("SELECT id FROM accounts WHERE email = $1", [email])).rows[0]?.id;
    if (!owner) throw new Error("the seeded persona eric is not in the database");
    const token = createHash("sha256").update("journey-deletion-receipt").digest("hex");
    const old = (await client.query("SELECT id FROM screenings WHERE token_hash = $1", [token])).rows[0];
    if (old) {
      await client.query("DELETE FROM deletion_receipts WHERE screening_id = $1", [old.id]);
      await client.query("DELETE FROM documents WHERE screening_id = $1", [old.id]);
      await client.query("DELETE FROM screenings WHERE id = $1", [old.id]);
    }
    const file = (
      await client.query(
        `INSERT INTO screenings (landlord_id, tenant_name, tenant_email, scope, provider, token_hash, expires_at, flow, requested_types)
         VALUES ($1, 'Léa Fictive', 'lea@demo.verikora.test', '{}', 'applicant-file', $2, now() + interval '30 days', 'file', '{pay-stub}') RETURNING id`,
        [owner, token],
      )
    ).rows[0];
    const bytes = Buffer.from("TALON DE PAIE FICTIF\nSalaire net : 2 000 $\n");
    await client.query(
      `INSERT INTO documents (owner_id, title, filename, mime_type, kind, size_bytes, sha256, content, text, storage, screening_id, document_type, retention_policy)
       VALUES ($1, 'Talon fictif', 'talon-fictif.txt', 'text/plain', 'other', $2, $3, $4, 'Salaire net : 2 000 $', 'database', $5, 'pay-stub', 'after-decision')`,
      [owner, bytes.length, createHash("sha256").update(bytes).digest("hex"), bytes, file.id],
    );
    return file.id;
  } finally {
    await client.end();
  }
}
