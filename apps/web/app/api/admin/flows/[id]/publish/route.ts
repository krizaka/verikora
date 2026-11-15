import { z } from "zod";

import { flowAdminRoute } from "@/lib/admin-routes";
import { publish } from "@/lib/flows";
import { readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Publishes a draft: it becomes immutable and the flow's current version (the previous one is retired; its analyses keep their id). */
export const POST = flowAdminRoute(async (admin, id, req) => {
  const input = await readJson(req, z.object({ versionId: z.string().uuid() }));
  return publish(admin, id, input.versionId, req.headers);
});
