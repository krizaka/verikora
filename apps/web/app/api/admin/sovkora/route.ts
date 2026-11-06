import { requireAdmin } from "@/lib/access";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { maskKey } from "@/lib/sovkora-status";

export const dynamic = "force-dynamic";

/**
 * This product's connection to Sovkora: its key (masked: never the key), the address, and this month's usage as Verikora
 * recorded it (runs started, failed) with the estimated cost. Sovkora's own plan, usage and cost figures are not exposed by
 * its API yet, so they are not shown rather than guessed.
 */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    const e = env();
    const [usage] = await query<{ runs: string; failed: string }>(
      "SELECT count(*) AS runs, count(*) FILTER (WHERE status = 'failed') AS failed FROM analyses WHERE run_id IS NOT NULL AND created_at >= date_trunc('month', now())",
    );
    const runs = Number(usage?.runs ?? 0);
    return Response.json(
      {
        key: maskKey(e.AI_API_KEY),
        baseUrl: e.AI_API_URL,
        usage: { runs, failed: Number(usage?.failed ?? 0), estimatedCostCents: runs * e.APP_ESTIMATED_RUN_COST_CENTS },
        sovkoraUsageAvailable: false,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
