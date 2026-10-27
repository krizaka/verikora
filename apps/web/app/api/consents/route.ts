import { z } from "zod";

import { requireSession } from "@/lib/access";
import { appEnvironment } from "@/lib/env";
import { availableFlows, grantConsent, revokeConsent } from "@/lib/flows";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";

export const dynamic = "force-dynamic";

const body = z.object({ key: z.string().regex(/^[a-z0-9-]{1,40}$/) });

/** Gives a consent a flow requires. Only a key an enabled flow actually asks for can be granted. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("consent", req, session.account.id);
    const { key } = await readJson(req, body);
    const flows = await availableFlows(appEnvironment(), { fallback: false });
    const asking = flows.find((f) => f.definition.consents.includes(key));
    if (!asking) throw refuse(404, "NOT_FOUND", "No flow asks for this consent");
    await grantConsent({ id: session.account.id, email: session.account.email }, key, req.headers, `${asking.key}@${asking.version}`);
    return Response.json({ key, granted: true }, { status: 201 });
  });
}

/** Withdraws a consent: the flow that requires it can no longer be started. */
export function DELETE(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    const { key } = await readJson(req, body);
    await revokeConsent({ id: session.account.id, email: session.account.email }, key, req.headers);
    return new Response(null, { status: 204 });
  });
}
