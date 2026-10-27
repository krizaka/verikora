import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { setBlocker } from "@/lib/compliance-gate";
import { handle, readJson } from "@/lib/http";
import { gateState, liveFlag, loadGate } from "@/lib/screening-checks/gate";

export const dynamic = "force-dynamic";

/** The compliance gate: each blocker before any live screening resale, and whether live mode would be allowed now. */
export function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const rows = await loadGate();
    return Response.json({ blockers: rows, live: gateState(await liveFlag(), rows) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** Marks a blocker done WITH the date and the reference of its evidence, or reopens it. */
export function PUT(req: Request) {
  return handle(async () => {
    const session = await requireAdmin(req);
    const input = await readJson(req, z.discriminatedUnion("status", [z.object({ blocker: z.string().max(60), status: z.literal("done"), evidenceOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), evidenceRef: z.string().trim().min(1).max(300) }), z.object({ blocker: z.string().max(60), status: z.literal("open") })]));
    await setBlocker({ id: session.account.id, email: session.account.email }, input, req.headers);
    return Response.json({ ok: true });
  });
}
