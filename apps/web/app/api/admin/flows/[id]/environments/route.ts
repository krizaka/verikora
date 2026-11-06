import { flowEnvironment } from "@verikora/core";
import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { isUuid } from "@/lib/documents";
import { setEnvironment } from "@/lib/flows";
import { handle, readJson, refuse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Enables or disables a flow in an environment: disabled, it is hidden everywhere there and cannot be started. */
export function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await params;
    if (!isUuid(id)) throw refuse(404, "NOT_FOUND", "No such flow");
    const input = await readJson(req, z.object({ environment: flowEnvironment, enabled: z.boolean() }));
    await setEnvironment(
      { id: session.account.id, email: session.account.email },
      id,
      input.environment,
      input.enabled,
      req.headers,
    );
    return Response.json({ environment: input.environment, enabled: input.enabled });
  });
}
