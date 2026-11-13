import { z } from "zod";

import { storesOf } from "@/app/active-store";
import { requireSession } from "@/lib/access";
import { DECISION_RETENTION } from "@/lib/retention-policy";
import { applicantFileOf, closeApplicantFile, revokeApplicantFile } from "@/lib/applicant-file";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";

export const dynamic = "force-dynamic";

/** One applicant file: its documents, their checks and the link's state. Another manager's file is not found. */
export function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    const { id } = await params;
    return Response.json(await applicantFileOf(session.account.id, id, new Date()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

/** The manager's actions: revoke the link, or close the file (the decision: every document is purged, the reports stay). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("applicantFileAction", req, session.account.id);
    const { id } = await params;
    const input = await readJson(
      req,
      z.discriminatedUnion("action", [
        z.object({ action: z.literal("revoke") }),
        z.object({
          action: z.literal("close"),
          retention: z.enum([DECISION_RETENTION.atDecision, DECISION_RETENTION.oneYear]).optional(),
        }),
      ]),
    );
    const now = new Date();
    if (input.action === "revoke") {
      await revokeApplicantFile(session.account.id, id, now, req.headers);
      return Response.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const closed = await closeApplicantFile(
      session.account.id,
      id,
      (await storesOf(session.account.id)).write,
      now,
      req.headers,
      input.retention,
    );
    return Response.json(closed, { headers: { "Cache-Control": "no-store" } });
  });
}
