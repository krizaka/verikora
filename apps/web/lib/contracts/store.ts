import { query } from "../db";
import type { ContractAttestation } from "./seal";

/** A sealed contract as the database keeps it: the file, and the columns that carry no personal information. */
export interface SealedRow {
  id: string;
  owner_id: string;
  partner_id: string;
  document_type: string;
  sha256: string;
  zone: string;
  key_id: string;
  sealed_at: Date;
  content: Buffer;
}

export interface SealedInput {
  id: string;
  ownerId: string;
  attestation: ContractAttestation;
  sha256: string;
  bytes: Uint8Array;
}

/** Keeps a sealed contract. The same id is kept once: a retry gets the first seal, never a second one. Returns the contract as kept. */
export async function keepSealed(input: SealedInput): Promise<{ row: SealedRow; created: boolean }> {
  const { id, ownerId, attestation, sha256, bytes } = input;
  const p = attestation.payload;
  const inserted = await query<SealedRow>(
    "INSERT INTO sealed_contracts (id, owner_id, partner_id, document_type, sha256, zone, key_id, sealed_at, content) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING RETURNING *",
    [id, ownerId, p.partnerId, p.documentType, sha256, p.zone, attestation.keyId, p.sealedAt, Buffer.from(bytes)],
  );
  if (inserted[0]) return { row: inserted[0], created: true };
  const [existing] = await query<SealedRow>("SELECT * FROM sealed_contracts WHERE id = $1 AND owner_id = $2", [id, ownerId]);
  return { row: existing!, created: false };
}

/** A contract this account sealed. */
export async function sealedOf(ownerId: string, id: string): Promise<SealedRow | null> {
  const [row] = await query<SealedRow>("SELECT * FROM sealed_contracts WHERE id = $1 AND owner_id = $2", [id, ownerId]);
  return row ?? null;
}

/** A sealed contract by the SHA-256 of its file — what the public check is asked. */
export async function sealedBySha(sha256: string): Promise<SealedRow | null> {
  const [row] = await query<SealedRow>("SELECT * FROM sealed_contracts WHERE sha256 = $1", [sha256]);
  return row ?? null;
}
