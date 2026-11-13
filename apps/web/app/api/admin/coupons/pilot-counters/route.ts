import { requireAdmin } from "@/lib/access";
import { pilotCounters } from "@/lib/coupons/pilot-counters";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The four counters of every pilot code (read-only, krizaka-internal#3230): totals per code and stage, never an account, an e-mail or an applicant. */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    return Response.json({ codes: await pilotCounters() }, { headers: { "Cache-Control": "private, no-store" } });
  });
