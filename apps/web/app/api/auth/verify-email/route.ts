import { randomUUID } from "node:crypto";

import { audit } from "@/lib/audit";
import { clientAddress } from "@/lib/client-address";
import { redeemCreditCode } from "@/lib/coupons/pilot";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { codeOf, fieldText, handle, HttpError } from "@/lib/http";
import { asLocale } from "@/lib/i18n";
import { limit } from "@/lib/limits";
import { verifyEmail } from "@/lib/signup";

/** The link's button: a form POST (a mail scanner opening the link cannot spend the token). Answers a redirect to the sign-in page. */
export function POST(req: Request) {
  return handle(async () => {
    await limit("verifyEmail", req, null);
    const form = await req.formData().catch(() => null);
    const token = fieldText(form, "token");
    const locale = asLocale(fieldText(form, "locale"));
    const result = await verifyEmail(
      {
        query,
        // The pilot code typed at sign-up is redeemed now that the address is real. A refusal (the pot ran out meanwhile) leaves the account confirmed and is on the trail.
        redeemPilot: async (accountId, code) => {
          try {
            await redeemCreditCode({
              code,
              accountId,
              idempotencyKey: `signup-pilot-${randomUUID()}`,
              ip: clientAddress(req.headers),
              pilotOnly: true,
              headers: req.headers,
            });
          } catch (error) {
            await audit({
              action: "billing.pilot_refused",
              actorId: accountId,
              actorLabel: "sign-up",
              detail: { at: "verification", reason: error instanceof HttpError ? codeOf(error, "ERROR") : "ERROR" },
              headers: req.headers,
            });
          }
        },
      },
      token,
      new Date(),
    );
    return Response.redirect(
      `${env().APP_PUBLIC_URL}/${locale}/sign-in?${result === "VERIFIED" ? "verified=1" : "verify=invalid"}`,
      303,
    );
  });
}
