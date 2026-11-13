import { requireAdmin } from "@/lib/access";
import { couponAction, couponPatch, parseParams, pilotFallsBackToPaid, redemptionQuery } from "@/lib/coupons/admin-api";
import { coupons, guarded } from "@/lib/coupons/instance";
import { query, transaction } from "@/lib/db";
import { handle, readJson, refuse } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** One coupon with its redemptions (never a customer's e-mail: the account id is all the admin sees). */
export const GET = (req: Request, { params }: Ctx) =>
  handle(async () => {
    await requireAdmin(req);
    const { id } = await params;
    const filter = parseParams(redemptionQuery, req.url);
    const coupon = await guarded(() => coupons.admin.get(query, id));
    if (!coupon) throw refuse(404, "COUPON_NOT_FOUND", "No such coupon");
    const redemptions = await guarded(() => coupons.admin.redemptions(query, { ...filter, couponId: id }));
    return Response.json({ coupon, redemptions }, { headers: { "Cache-Control": "private, no-store" } });
  });

/** Changes a coupon: its window, limits, plans, status and partner. Its terms are locked once anyone has used it (409 COUPON_TERMS_LOCKED). */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await params;
    const parsed = await readJson(req, couponPatch);
    const current = await guarded(() => coupons.admin.get(query, id));
    const patch = pilotFallsBackToPaid(parsed.purpose ?? current?.purpose, parsed);
    const coupon = await guarded(() =>
      transaction((tx) =>
        coupons.admin.update(tx, { id: session.account.id, label: session.account.email }, id, patch),
      ),
    );
    return Response.json({ coupon });
  });

/** Pauses, resumes or archives a coupon; revokes a credit redemption (what is left of its grant is written off, what was spent is never taken back). */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await params;
    const input = await readJson(req, couponAction);
    const actor = { id: session.account.id, label: session.account.email };
    return guarded(() =>
      transaction(async (tx) => {
        if (input.action === "revoke") {
          await coupons.revoke(tx, actor, input.redemptionId);
          return Response.json({ revoked: input.redemptionId });
        }
        const change = { pause: coupons.admin.pause, resume: coupons.admin.resume, archive: coupons.admin.archive }[
          input.action
        ];
        return Response.json({ coupon: await change(tx, actor, id) });
      }),
    );
  });
