import { requireAdmin } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { openIncidentInput } from "@/lib/incident-input";
import { incidentRegister, openIncident } from "@/lib/incidents";

export const dynamic = "force-dynamic";

/** The confidentiality incident register of this product (Loi 25, verikora#418). Administrators only. */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    return Response.json(
      { incidents: await incidentRegister() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });

/** Opens an incident (audited). */
export const POST = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const input = await readJson(req, openIncidentInput);
    const incident = await openIncident(session.account, input, req.headers);
    return Response.json({ incident }, { status: 201 });
  });
