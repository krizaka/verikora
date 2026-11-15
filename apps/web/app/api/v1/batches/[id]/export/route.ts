import { systemClock } from "@/app/system-clock";
import { apiCaller } from "@/lib/api-v1/caller";
import { batchZipResponse } from "@/lib/batch/export-for";
import { isUuid } from "@/lib/documents";
import { handle, refuse } from "@/lib/http";
import { asLocale } from "@/lib/i18n";
import { limit } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** The reports of a batch in one ZIP with a key (`reports:read`): `lot.csv`, the signed PDFs in `?lang=fr|en` (French when omitted, as the OpenAPI document says), the authenticity signals. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const caller = await apiCaller(req, "reports:read", systemClock);
    const id = (await params).id;
    if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such batch");
    await limit("batchExport", req, caller.account.id);
    return batchZipResponse(
      caller.account.id,
      id,
      asLocale(new URL(req.url).searchParams.get("lang") ?? "fr"),
      { action: "api.batch.exported", actorId: caller.account.id, actorLabel: `api-key:${caller.keyId}` },
      req.headers,
    );
  });
}
