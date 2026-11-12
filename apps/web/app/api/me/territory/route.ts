import { territory } from "@verikora/core";
import { z } from "zod";

import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { setTerritory } from "@/lib/territory";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Which territory's checks the person is offered (Québec until they choose). */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    return Response.json({ territory: session.account.territory }, { headers: NO_STORE });
  });
}

/** Changes the territory: the check page lists that jurisdiction's checks. One of a closed set. */
export function PUT(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("perspective", req, session.account.id);
    const input = await readJson(req, z.object({ territory }));
    await setTerritory(session.account.id, input.territory);
    await audit({
      action: "profile.territory_set",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: session.account.id,
      detail: { from: session.account.territory, to: input.territory },
      headers: req.headers,
    });
    return Response.json({ territory: input.territory }, { headers: NO_STORE });
  });
}
