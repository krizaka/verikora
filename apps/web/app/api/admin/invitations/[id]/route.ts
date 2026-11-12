import { z } from "zod";

import { mailConfigured } from "@/app/accounts-edge";
import { requireAdmin } from "@/lib/access";
import { transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { mailerFor } from "@/lib/mailer";
import { resendInvitation, revokeInvitation } from "@/lib/signup-invitation";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke") }),
  z.object({ action: z.literal("resend"), locale: z.enum(["en", "fr"]) }),
]);

/** Revokes an open invitation, or sends it again with a new link. Audited, rate-limited per admin. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const session = await requireAdmin(req);
    await limit("invite", req, session.account.id);
    const { id } = await params;
    const input = await readJson(req, body);
    const actor = { id: session.account.id, label: session.account.email };
    const now = new Date();
    if (input.action === "revoke") {
      await revokeInvitation(transaction, actor, id, now, req.headers);
      return Response.json({ revoked: true });
    }
    if (!mailConfigured()) {
      throw refuse(503, "MAIL_OFF", "E-mail sending is not available");
    }
    const e = env();
    const invitation = await resendInvitation(
      { run: transaction, mail: mailerFor(e), baseUrl: e.APP_PUBLIC_URL, headers: req.headers },
      actor,
      id,
      input.locale,
      now,
    );
    return Response.json({ invitation }, { headers: { "Cache-Control": "private, no-store" } });
  });
