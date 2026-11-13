import { requireAdmin } from "@/lib/access";
import { couponQuery, newCoupon, parseParams, pilotFallsBackToPaid } from "@/lib/coupons/admin-api";
import { coupons, guarded } from "@/lib/coupons/instance";
import { query, transaction } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { appSettings } from "@/lib/settings/instance";

export const dynamic = "force-dynamic";

/** The coupons, filtered and paged (status, kind, purpose, partner). « Expired », « exhausted » and « not started » are computed by the console from the dates and the uses. */
export const GET = (req: Request) =>
  handle(async () => {
    await requireAdmin(req);
    const filter = parseParams(couponQuery, req.url);
    return Response.json(
      {
        enabled: (await appSettings().get("coupons.enabled")) === true,
        coupons: await guarded(() => coupons.admin.list(query, filter)),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });

/** Creates a coupon (audited in the same transaction). The package refuses a free discount, an unlimited credit and a credit without an expiry. */
export const POST = (req: Request) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const parsed = await readJson(req, newCoupon);
    const input = pilotFallsBackToPaid(parsed.purpose, parsed);
    const coupon = await guarded(() =>
      transaction((tx) => coupons.admin.create(tx, { id: session.account.id, label: session.account.email }, input)),
    );
    return Response.json({ coupon }, { status: 201 });
  });
