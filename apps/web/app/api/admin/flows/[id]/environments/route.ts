import { flowEnvironment } from "@verikora/core";
import { z } from "zod";

import { flowAdminRoute } from "@/lib/admin-routes";
import { setEnvironment } from "@/lib/flows";
import { readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Enables or disables a flow in an environment: disabled, it is hidden everywhere there and cannot be started. */
export const PUT = flowAdminRoute(async (admin, id, req) => {
  const input = await readJson(req, z.object({ environment: flowEnvironment, enabled: z.boolean() }));
  await setEnvironment(admin, id, input.environment, input.enabled, req.headers);
  return { environment: input.environment, enabled: input.enabled };
});
