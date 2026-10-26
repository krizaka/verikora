import { createHash } from "node:crypto";

import { verifySeal } from "@/lib/contracts/seal";
import { sealedBySha } from "@/lib/contracts/store";
import { handle, refuse } from "@/lib/http";
import { limit } from "@/lib/rate-limit";
import { signingKey } from "@/lib/report-signer";

export const dynamic = "force-dynamic";

const sha256Of = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * The public check of a sealed contract (yomizaka#71), by the SHA-256 of its file: whether Yomizaka sealed it, when and under which
 * key — and nothing of what it says: no name, no account, no content. Anyone who holds a copy can compute its hash and ask.
 * Also reachable at `/verify/contract/<sha256>` (308).
 */
export function GET(req: Request, { params }: { params: Promise<{ sha256: string }> }) {
  return handle(async () => {
    limit("verify-contract", req, null, [60, 60]);
    const { sha256 } = await params;
    const row = /^[0-9a-f]{64}$/.test(sha256) ? await sealedBySha(sha256) : null;
    if (!row) throw refuse(404, "UNKNOWN_SEAL", "Yomizaka has no seal with this SHA-256");
    // The file is read again and checked now: a stored copy that was altered is not vouched for — its bytes are no longer the ones that were sealed.
    if (sha256Of(row.content) !== row.sha256) return Response.json({ valid: false, reason: "ALTERED", sha256 }, { status: 409 });
    const verdict = await verifySeal(new Uint8Array(row.content), signingKey());
    if (!verdict.valid) return Response.json({ valid: false, reason: verdict.reason, sha256 }, { status: 409 });
    const p = verdict.attestation.payload;
    return Response.json({ valid: true, sha256, contractId: p.contractId, partnerId: p.partnerId, documentType: p.documentType, sealedAt: p.sealedAt, zone: p.zone, keyId: verdict.attestation.keyId }, { headers: { "cache-control": "public, max-age=300" } });
  });
}
