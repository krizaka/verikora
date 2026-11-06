import { audience } from "@verikora/core";
import { z } from "zod";

import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { setPerspective } from "@/lib/perspective";

export const dynamic = "force-dynamic";

/** Which side of the lease the signed-in person is on (null until they choose at onboarding). */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    return Response.json(
      { perspective: session.account.perspective },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

/** Chooses or changes the side: the default checks and the wording follow. */
export function PUT(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("perspective", req, session.account.id);
    const input = await readJson(req, z.object({ perspective: audience }));
    await setPerspective(session.account.id, input.perspective);
    await audit({
      action: "profile.perspective_set",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: session.account.id,
      detail: { from: session.account.perspective, to: input.perspective },
      headers: req.headers,
    });
    return Response.json({ perspective: input.perspective }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
