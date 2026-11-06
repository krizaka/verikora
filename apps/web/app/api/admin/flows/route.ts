import { flowDefinition } from "@verikora/core";
import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { createFlow, listAdminFlows } from "@/lib/flows";
import { handle, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The flows and their versions, for the administration (ADMIN role, allowed address — or 403). */
export function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    return Response.json({ flows: await listAdminFlows() });
  });
}

/** Creates a flow with its first draft. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireAdmin(req);
    const input = await readJson(
      req,
      z.object({ key: z.string().regex(/^[a-z0-9-]{1,60}$/), definition: flowDefinition }),
    );
    const created = await createFlow(
      { id: session.account.id, email: session.account.email },
      input.key,
      input.definition,
      req.headers,
    );
    return Response.json(created, { status: 201 });
  });
}
