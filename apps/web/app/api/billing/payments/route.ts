import { stripeCall } from "@krizaka/payments";

import { requireSession } from "@/lib/access";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { limit } from "@/lib/limits";
import { fetchPaymentHistory } from "@/lib/payments/payment-history";

export const dynamic = "force-dynamic";

/** The last payments of the account (date, what, amount, receipt link), read from the processor on the server (verikora#585). Empty when payments are off or nothing was bought. */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("portal", req, session.account.id);
    const { PAYMENTS_PROVIDER: provider, PAYMENTS_STRIPE_SECRET_KEY: secretKey } = env();
    const [row] = await query<{ payment_customer_id: string | null }>(
      "SELECT payment_customer_id FROM accounts WHERE id = $1",
      [session.account.id],
    );
    const payments =
      provider === "stripe" && secretKey && row?.payment_customer_id
        ? await fetchPaymentHistory(stripeCall({ secretKey }).call, row.payment_customer_id)
        : [];
    return Response.json({ payments }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
