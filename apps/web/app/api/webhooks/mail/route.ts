import { consoleLog, handleMailgunWebhook } from "@krizaka/email";

import { systemClock } from "@/app/system-clock";
import { env } from "@/lib/env";
import { handle, refuse } from "@/lib/http";
import { pgSuppression } from "@/lib/mail/store";

export const dynamic = "force-dynamic";

/**
 * The mail provider's bounce and complaint webhook (yomizaka#48): signed by the vendor (HMAC with `MAIL_WEBHOOK_SIGNING_KEY`, a replay
 * window), refused without a valid signature; a hard bounce, a complaint or an unsubscribe puts the address on the suppression list,
 * and it is never mailed again. 404 while no signing key is set (the route has nothing to check a signature with).
 */
export function POST(req: Request) {
  return handle(async () => {
    const signingKey = env().MAIL_WEBHOOK_SIGNING_KEY;
    if (!signingKey) throw refuse(404, "NOT_FOUND", "No mail webhook here");
    const body: unknown = await req.json().catch(() => null);
    const result = await handleMailgunWebhook(body, { signingKey, suppression: pgSuppression, log: consoleLog(), now: () => systemClock.now() });
    // 401 for a bad signature (the vendor keeps trying); 406 for a body that is no event of ours (the vendor stops).
    if (!result.ok) throw refuse(result.error === "signature" ? 401 : 406, result.error === "signature" ? "BAD_SIGNATURE" : "BAD_PAYLOAD", `Mail webhook refused: ${result.error}`);
    return Response.json({ ok: true, action: result.action });
  });
}
