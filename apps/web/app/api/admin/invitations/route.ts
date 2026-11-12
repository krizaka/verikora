import { mailConfigured } from "@/app/accounts-edge";
import { requireAdmin } from "@/lib/access";
import { query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { mailerFor } from "@/lib/mailer";
import { inviteBody, inviteManager, pendingInvitations, pilotCoupons } from "@/lib/signup-invitation";

export const dynamic = "force-dynamic";

/** The open invitations to a closed sign-up, and the pilot coupons an invitation may carry (krizaka-internal#3230). Admin only. */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    const now = new Date();
    const [invitations, pilots] = await Promise.all([pendingInvitations(query, now), pilotCoupons(query, now)]);
    return Response.json({ invitations, pilots }, { headers: { "Cache-Control": "private, no-store" } });
  });

/** Invites a property manager by address, with an optional pilot coupon; the link is mailed, never answered (503 MAIL_OFF while mail is not configured). Audited, rate-limited per admin. */
export const POST = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    await limit("invite", req, session.account.id);
    const input = await readJson(req, inviteBody);
    if (!mailConfigured()) {
      throw refuse(503, "MAIL_OFF", "E-mail sending is not available");
    }
    const e = env();
    const invitation = await inviteManager(
      { run: transaction, mail: mailerFor(e), baseUrl: e.APP_PUBLIC_URL, headers: req.headers },
      { id: session.account.id, label: session.account.email },
      input,
      new Date(),
    );
    return Response.json({ invitation }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
