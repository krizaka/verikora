import { STORAGE_MODE } from "@verikora/core";
import { z } from "zod";

import { storesOf, workingStore } from "@/app/active-store";
import { fileByToken, uploadApplicantDocument } from "@/lib/applicant-file";
import { handle, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { VERIKORA_RULES } from "@/lib/preflight/rules";
import { capsFor } from "@/lib/prices/caps";
import { preflightRulesFrom } from "@/lib/settings/boundary";
import { settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

const token = z.string().min(20).max(80);
const typeId = z.string().min(2).max(40);

/**
 * The applicant sends one document of the file (verikora#127): multipart, fields `token`, `typeId` and `file` (a PDF). The
 * link must be open and the applicant must have consented to the document check (refused before any byte is stored). The
 * document is checked by the owner's Sovkora runs and kept only if the applicant consented to keep it until the decision.
 */
export function POST(req: Request) {
  return handle(async () => {
    await limit("applicantUpload", req, null);
    const form = await req.formData().catch(() => null);
    const parsedToken = token.safeParse(form?.get("token"));
    const parsedType = typeId.safeParse(form?.get("typeId"));
    const file = form?.get("file");
    if (!parsedToken.success || !parsedType.success || !(file instanceof File))
      throw refuse(400, "BAD_REQUEST", "A token, a document type and a file are expected");
    const link = await fileByToken(parsedToken.data);
    const stores = await storesOf(link.landlord_id);
    const settings = await settingsFor(link.landlord_id);
    const made = await uploadApplicantDocument(
      parsedToken.data,
      parsedType.data,
      { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) },
      {
        store: stores.write,
        working: await workingStore(),
        purgeAfterHours: settings["limits.purgeAfterHours"].value as number,
        rules: preflightRulesFrom(VERIKORA_RULES, settings),
        keepAllowed: stores.settings.mode !== STORAGE_MODE.none,
        auditCaps: capsFor(settings, new Date()),
      },
      new Date(),
      req.headers,
    );
    return Response.json(made, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
