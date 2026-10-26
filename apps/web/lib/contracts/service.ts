import { STORAGE_KIND } from "@yomizaka/core";

import { refuse } from "../http";
import { publicKeyBase64, type SigningKey } from "../report-key";
import { SITE_URL } from "../site";
import { noneStore } from "../storage/none";
import { storedAs } from "../storage/where";
import type { SealRequest } from "./request";
import { attestationOf, contractIdOf, sealPdf } from "./seal";
import { keepSealed, type SealedRow } from "./store";
import { inZone, ZONE } from "./zone";

/**
 * Sealing a contract for a partner (yomizaka#71). The sealed file is kept in Yomizaka's database (Toronto, `tor1`, encrypted at rest) —
 * the zone it can honestly name today is `CA` or `CA-ON`: a request for another zone (`CA-QC`) is refused until a store in that zone exists,
 * never answered with a place the file is not in.
 */
export const KEPT_IN = (): { region: string | null } => storedAs(STORAGE_KIND.database, noneStore().describe());

/** The zone asked for (`X-Data-Residency-Zone`, `CA` by default), checked against where the file would be kept. */
export function zoneAsked(header: string | null): string {
  const zone = (header ?? "CA").trim().toUpperCase();
  if (!ZONE.test(zone)) throw refuse(400, "BAD_ZONE", "X-Data-Residency-Zone is a country or a province, like CA or CA-QC");
  if (!inZone(KEPT_IN().region, zone)) throw refuse(409, "ZONE_UNAVAILABLE", `Contracts cannot be kept in ${zone} yet`, { zone });
  return zone;
}

export interface SealAnswer {
  success: true;
  contractId: string;
  sha256: string;
  signedPdfUri: string;
  sealedAt: string;
  attestation: { signature: string; publicKey: string; keyId: string };
}

export const answerOf = (row: SealedRow, signature: string, key: SigningKey): SealAnswer => ({
  success: true,
  contractId: row.id,
  sha256: row.sha256,
  signedPdfUri: `${SITE_URL}/api/v1/contracts/${row.id}/file`,
  sealedAt: row.sealed_at.toISOString().replace(/\.\d{3}Z$/, "Z"),
  attestation: { signature, publicKey: publicKeyBase64(key), keyId: row.key_id },
});

/** Seals the request, or returns the seal already made for it (a retry): same id, same file. `now` is the clock, injected. */
export async function sealContract(args: { ownerId: string; request: SealRequest; zone: string; now: Date; key: SigningKey }): Promise<{ answer: SealAnswer; created: boolean }> {
  const { ownerId, request, zone, now, key } = args;
  const id = contractIdOf(ownerId, request);
  const sealedAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const sealed = await sealPdf(request, { contractId: id, sealedAt, zone }, key);
  const { row, created } = await keepSealed({ id, ownerId, attestation: sealed.attestation, sha256: sealed.sha256, bytes: sealed.bytes });
  // A retry returns the first seal as it was made (its own signature, read back from the file), not the one just computed.
  const signature = created ? sealed.attestation.signature : ((await attestationOf(row.content))?.signature ?? "");
  return { answer: answerOf(row, signature, key), created };
}
