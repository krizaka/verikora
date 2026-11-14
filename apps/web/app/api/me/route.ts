import { meResponse } from "@krizaka/auth/contract";

import { requestSessionToken } from "@/lib/access";
import { env } from "@/lib/env";
import { handle, HttpError } from "@/lib/http";
import { limit } from "@/lib/limits";
import { resolveSession } from "@/lib/session";
import { assertOpen } from "@/lib/settings/guards";
import { signupOpenNow } from "@/lib/settings/signup";

export const dynamic = "force-dynamic";

/**
 * Who is signed in, and whether sign-up is open (the family's `GET /api/me`, krizaka-ui#551): 200 `{ signedIn, signupOpen, account? }`,
 * never cached (`private, no-store`, `Vary: Cookie`). Signed out is not an error: no session, an expired one, or a maintenance that
 * closes the app to this person is `signedIn: false`. The public pages stay static and the bar asks this from the browser.
 */
export const GET = (req: Request) =>
  handle(async () => {
    const session = await resolveSession(requestSessionToken(req.headers));
    let account = null;
    if (session) {
      try {
        await assertOpen(session.account);
        account = {
          id: session.account.id,
          email: session.account.email,
          name: session.account.name ?? null,
          avatarSeed: session.account.avatarSeed ?? null,
        };
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
      }
    }
    await limit("accountRead", req, account?.id ?? null, "me");
    return meResponse({ signupOpen: await signupOpenNow(env()), account });
  });
