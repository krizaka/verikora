import { randomUUID } from "node:crypto";

import { clientAddress } from "@/lib/client-address";
import { checkPilotCode } from "@/lib/coupons/pilot";
import { query, transaction } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { mailerFor } from "@/lib/mailer";
import { assertOpen } from "@/lib/settings/guards";
import { signupOpenNow } from "@/lib/settings/signup";
import { signUp, signUpBody } from "@/lib/signup";
import { invitedSignUpBody, signUpWithInvitation } from "@/lib/signup-invitation";

const closed = () => refuse(403, "SIGNUP_CLOSED", "Sign-up is closed");

/** The body names an invitation (`invite`): read without consuming the request, so the body is parsed once against the right schema. */
async function invitationOf(req: Request): Promise<boolean> {
  const raw: unknown = await req
    .clone()
    .json()
    .catch(() => null);
  return typeof raw === "object" && raw !== null && "invite" in raw;
}

/**
 * Sign-up, for Verikora only. Closed unless the `signup.open` setting is on (its default is `AUTH_SIGNUP_ENABLED`) AND the verification e-mail can be sent (the refusal
 * is the server's, whatever a page shows). The answer is the same whether or not the address already has an account.
 * An administration's invitation (krizaka-internal#3230) is the one way in while it is closed, and for the invited address only: the account is created verified, with
 * the invitation's pilot, in one transaction (201). Abuse limits: 5 sign-ups per hour per address of the client, 3 per hour per e-mail address.
 */
export function POST(req: Request) {
  return handle(async () => {
    await assertOpen({ role: "USER" });
    if (await invitationOf(req)) {
      const input = await readJson(req, invitedSignUpBody);
      await limit("signUp", req, input.email);
      const { pilot } = await signUpWithInvitation(
        {
          run: transaction,
          ip: clientAddress(req.headers),
          headers: req.headers,
          idempotencyKey: `invite-pilot-${randomUUID()}`,
        },
        input,
        new Date(),
      );
      return Response.json({ ok: true, verified: true, pilot }, { status: 201 });
    }
    if (!(await signupOpenNow(env()))) throw closed();
    const input = await readJson(req, signUpBody);
    await limit("signUp", req, input.email);
    // A pilot code is refused here, with its code, before any account or mail; it is redeemed when the address is confirmed. It never opens sign-up by itself (the check above).
    if (input.pilotCode) {
      await checkPilotCode(input.pilotCode, clientAddress(req.headers));
    }
    const e = env();
    await signUp({ query, mail: mailerFor(e), baseUrl: e.APP_PUBLIC_URL }, input, new Date());
    return Response.json({ ok: true }, { status: 202 });
  });
}
