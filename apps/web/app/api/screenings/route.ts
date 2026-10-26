import { z } from "zod";

import { requireSession } from "@/lib/access";
import { appEnvironment } from "@/lib/env";
import { resolveFlow } from "@/lib/flows";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { listForLandlord, requestScreening } from "@/lib/screening";
import { allowedFor, priceCents } from "@/lib/screening-checks/catalogue";

export const dynamic = "force-dynamic";

const FLOW = "tenant-screening";

/** The landlord's requests and what the tenants shared. Needs the flow enabled and the landlord's undertaking granted. */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await resolveFlow(session.account, FLOW, appEnvironment());
    const offered = (await allowedFor(session.account.id)).map((t) => ({ key: t.key, labelFr: t.label_fr, labelEn: t.label_en, priceCents: priceCents(t), currency: t.currency }));
    return Response.json({ screenings: await listForLandlord(session.account.id, new Date()), offered }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/** Asks a tenant's consent to check their application. Returns the link's token once; the landlord hands it to the applicant. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("screeningRequest", req, session.account.id);
    await resolveFlow(session.account, FLOW, appEnvironment());
    const input = await readJson(req, z.object({ tenantName: z.string().trim().min(1).max(120), tenantEmail: z.string().trim().toLowerCase().email().max(254), scope: z.array(z.string().max(40)).min(1).max(8) }));
    const made = await requestScreening({ id: session.account.id, email: session.account.email }, input, new Date(), req.headers);
    return Response.json(made, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
