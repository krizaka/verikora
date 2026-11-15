import { flowDefinition } from "@verikora/core";
import { z } from "zod";

import { flowAdminRoute } from "@/lib/admin-routes";
import { saveDraft } from "@/lib/flows";
import { readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Saves the open draft of a flow (or opens one): a published version is never edited. */
export const PUT = flowAdminRoute(async (admin, id, req) => {
  const input = await readJson(req, z.object({ definition: flowDefinition }));
  return saveDraft(admin, id, input.definition, req.headers);
});
