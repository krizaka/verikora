import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { mailerFor } from "@/lib/mailer";
import { assertOpen } from "@/lib/settings/guards";
import { signupOpenNow } from "@/lib/settings/signup";
import { signUp, signUpBody } from "@/lib/signup";

/**
 * Sign-up, for Verikora only. Closed unless the `signup.open` setting is on (its default is `AUTH_SIGNUP_ENABLED`) AND the verification e-mail can be sent (the refusal
 * is the server's, whatever a page shows). The answer is the same whether or not the address already has an account.
 * Abuse limits: 5 sign-ups per hour per address of the client, 3 per hour per e-mail address.
 */
export function POST(req: Request) {
  return handle(async () => {
    await assertOpen({ role: "USER" });
    if (!(await signupOpenNow(env()))) throw refuse(403, "SIGNUP_CLOSED", "Sign-up is closed");
    const input = await readJson(req, signUpBody);
    await limit("signUp", req, input.email);
    const e = env();
    await signUp({ query, mail: mailerFor(e), baseUrl: e.APP_PUBLIC_URL }, input, new Date());
    return Response.json({ ok: true }, { status: 202 });
  });
}
