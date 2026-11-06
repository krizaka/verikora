import { z } from "zod";

import { requireSession } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { createShare, listShares, revokeShare } from "@/lib/owner-report-shares";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

/** The links of this file's report (verikora#128), for its manager only. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    return Response.json({ shares: await listShares(session.account.id, id, new Date()) }, { headers: noStore });
  });
}

/** Creates a link for the building owner: the token is returned once, only its hash is kept. */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("reportGrant", req, session.account.id);
    const { id } = await params;
    const input = await readJson(
      req,
      z.object({ recipient: z.string().max(120).optional(), days: z.number().int().optional() }),
    );
    return Response.json(
      await createShare({ id: session.account.id, email: session.account.email }, id, input, new Date(), req.headers),
      { status: 201, headers: noStore },
    );
  });
}

/** Revokes a link: it opens nothing from now on. */
export function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("reportGrant", req, session.account.id);
    const { id } = await params;
    const { shareId } = await readJson(req, z.object({ shareId: z.string() }));
    await revokeShare({ id: session.account.id, email: session.account.email }, id, shareId, req.headers);
    return Response.json({ revoked: true }, { headers: noStore });
  });
}
