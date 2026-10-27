import { z } from "zod";

import { handle, readJson } from "@/lib/http";
import { getDictionary } from "@/lib/i18n";
import { limit } from "@/lib/limits";
import { consent, contest, copyForTenant, decline, share, viewForTenant } from "@/lib/screening";
import { labelsIn } from "@/lib/screening-checks/catalogue";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ token: z.string().min(20).max(80), action: z.literal("view") }),
  z.object({ token: z.string().min(20).max(80), action: z.literal("consent") }),
  z.object({ token: z.string().min(20).max(80), action: z.literal("decline") }),
  z.object({ token: z.string().min(20).max(80), action: z.literal("share") }),
  z.object({ token: z.string().min(20).max(80), action: z.literal("copy"), locale: z.enum(["en", "fr"]) }),
  z.object({ token: z.string().min(20).max(80), action: z.literal("contest"), comment: z.string().trim().max(500).default("") }),
]);

/**
 * The tenant's side, reached by the link the landlord handed over (an unguessable token whose hash is all that is kept): view
 * the request, consent or decline, see the result, take a copy of it, share it with the landlord or contest it. No account is needed. Rate-limited
 * by address; every action is audit-logged.
 */
export function POST(req: Request) {
  return handle(async () => {
    await limit("screeningRespond", req, null);
    const input = await readJson(req, body);
    const now = new Date();
    if (input.action === "copy") {
      const t = getDictionary(input.locale).screening.tenant;
      const copy = await copyForTenant(input.token, await labelsIn(input.locale), { outcome: t.outcome, band: t.band, keptUntil: t.deleteOn, title: t.resultTitle }, now, req.headers);
      return Response.json({ copy }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const act = () => {
      switch (input.action) {
        case "view":
          return viewForTenant(input.token, now);
        case "consent":
          return consent(input.token, now, req.headers);
        case "decline":
          return decline(input.token, now, req.headers);
        case "share":
          return share(input.token, now, req.headers);
        default:
          return contest(input.token, input.comment, now, req.headers);
      }
    };
    const view = await act();
    return Response.json({ screening: view }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
