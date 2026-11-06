import { requireAdmin } from "@/lib/access";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { preflightMetrics } from "@/lib/preflight-events";

export const dynamic = "force-dynamic";

/** The pre-flight's metrics per tenant: files accepted, refused, results reused — Sovkora runs avoided, with an ESTIMATED saving. */
export function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const cost = env().APP_ESTIMATED_RUN_COST_CENTS;
    return Response.json(
      {
        estimate: { runCostCents: cost, note: "estimated, not measured" },
        tenants: await preflightMetrics(query, cost),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
