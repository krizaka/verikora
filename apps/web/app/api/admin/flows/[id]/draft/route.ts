import { flowDefinition } from "@verikora/core";
import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { isUuid } from "@/lib/documents";
import { saveDraft } from "@/lib/flows";
import { handle, readJson, refuse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Saves the open draft of a flow (or opens one): a published version is never edited. */
export function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await params;
    if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such flow");
    const input = await readJson(req, z.object({ definition: flowDefinition }));
    return Response.json(
      await saveDraft({ id: session.account.id, email: session.account.email }, id, input.definition, req.headers),
    );
  });
}
