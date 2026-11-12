import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { clientAddress } from "@/lib/client-address";
import { redeemCreditCode } from "@/lib/coupons/pilot";
import { handle, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

const body = z.object({ code: z.string().trim().min(1).max(80) });

/**
 * Redeems a credit code: the same rules as a discount, then a capped, expiring grant on the credits ledger, in one transaction. One key per try, so a double click
 * is one grant (a second use of the same code is refused by its per-account limit, a second pilot code by `PILOT_ALREADY_USED`).
 */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    const { code } = await readJson(req, body);
    const redeemed = await redeemCreditCode({
      code,
      accountId: session.account.id,
      idempotencyKey: `redeem-${randomUUID()}`,
      ip: clientAddress(req.headers),
      headers: req.headers,
      actorLabel: session.account.email,
    });
    await audit({
      action: "billing.credit_code_redeemed",
      actorId: session.account.id,
      actorLabel: session.account.email,
      detail: { redemptionId: redeemed.redemptionId, credits: redeemed.credits },
      headers: req.headers,
    });
    return Response.json({
      credits: redeemed.credits,
      expiresAt: redeemed.expiresAt.toISOString(),
      replayed: redeemed.replayed,
    });
  });
}
