import { z } from "zod";

import { systemClock } from "@/app/system-clock";
import { requireAdmin } from "@/lib/access";
import { handle, readJson, refuse } from "@/lib/http";
import { guard } from "@/lib/organisation/organize";
import { isListKind } from "@/lib/workspace/decl";
import { actorOf, workspaceFor } from "@/lib/workspace/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ kind: string }> };

const kindOf = async (params: Params["params"]) => {
  const { kind } = await params;
  if (!isListKind(kind)) {
    throw refuse(404, "NOT_FOUND", "No such kind");
  }
  return kind;
};

/** The kind's configuration, as the administration edits it. ADMIN role and allowed address only. */
export const GET = (req: Request, { params }: Params) =>
  handle(async () => {
    await requireAdmin(req);
    const kind = await kindOf(params);
    return Response.json(
      { configuration: await workspaceFor({ clock: systemClock }).config.get(kind) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });

/**
 * The administration changes the vocabulary (the decision set, its words and tones, the tag rules, the system views): checked by the
 * layer, versioned (a stale editor is 409 CONFLICT), audited, and refused when it drops a state a file still holds (409 STATE_IN_USE).
 * The screens of the editors are `TagSetEditor` and `StatusSetEditor` of Krizaka UI (`components/admin/OrganisationPanel.tsx`).
 */
export const PUT = (req: Request, { params }: Params) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const kind = await kindOf(params);
    const input = await readJson(req, z.object({ config: z.unknown(), expected: z.number().int().min(1).nullable() }));
    const saved = await guard(() =>
      workspaceFor({ clock: systemClock, headers: req.headers }).config.put(
        actorOf(session.account),
        { ...(input.config as object), kind },
        input.expected,
      ),
    );
    return Response.json({ configuration: saved }, { headers: { "Cache-Control": "private, no-store" } });
  });
