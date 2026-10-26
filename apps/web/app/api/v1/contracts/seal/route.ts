import { systemClock } from "@/app/system-clock";
import { apiCaller } from "@/lib/api-v1/caller";
import { audit } from "@/lib/audit";
import { sealRequest } from "@/lib/contracts/request";
import { sealContract, zoneAsked } from "@/lib/contracts/service";
import { handle, readJson } from "@/lib/http";
import { signingKey } from "@/lib/report-signer";

export const dynamic = "force-dynamic";

/**
 * Seals a contract for a partner platform with an API key (`contracts:seal`): the content, the parties and the framework the
 * partner names, sent as JSON; the answer carries the sealed PDF's SHA-256 and attestation. The same request is the same contract:
 * a retry answers 200 with the first seal, a new one 201. Yomizaka seals — it verifies no identity and no law.
 */
export function POST(req: Request) {
  return handle(async () => {
    const caller = await apiCaller(req, "contracts:seal", systemClock);
    const zone = zoneAsked(req.headers.get("x-data-residency-zone"));
    const request = await readJson(req, sealRequest);
    const { answer, created } = await sealContract({ ownerId: caller.account.id, request, zone, now: systemClock.now(), key: signingKey() });
    if (created) await audit({ action: "api.contract.sealed", actorId: caller.account.id, actorLabel: `api-key:${caller.keyId}`, targetId: null, detail: { contractId: answer.contractId, partnerId: request.partnerId, documentType: request.documentType, zone }, headers: req.headers });
    return Response.json(answer, { status: created ? 201 : 200 });
  });
}
