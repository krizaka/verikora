import { cookies } from "next/headers";
import { z } from "zod";

import { hostAllowed } from "@/lib/access";
import { checkPassword } from "@/lib/accounts";
import { clientAddress } from "@/lib/client-address";
import { query } from "@/lib/db";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { createSession, verikoraSessionCookie } from "@/lib/session";
import { assertOpen } from "@/lib/settings/guards";

const body = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256),
  client: z.enum(["web", "native"]).default("web"),
});

/** E-mail and password → a session cookie (`client: "native"`: the token in the answer, for a bearer). 10 tries per address and 30 per IP every 15 minutes. */
export function POST(req: Request) {
  return handle(async () => {
    if (!hostAllowed(req.headers)) throw refuse(403, "IP_NOT_ALLOWED", "This address may not use the administration");
    const { email, password, client } = await readJson(req, body);
    await limit("signIn", req, email);
    const account = await checkPassword(email, password, req.headers);
    // During maintenance only an administrator signs in.
    const [who] = await query<{ role: "USER" | "ADMIN" }>("SELECT role FROM accounts WHERE id = $1", [account.id]);
    await assertOpen({ role: who?.role ?? "USER" });
    const { token, expires } = await createSession(account.id, {
      ip: clientAddress(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    const signedIn = { email: account.email, locale: account.locale };
    // A native app keeps the token in its Keychain and sends it as a bearer; it never gets a cookie.
    if (client === "native")
      return Response.json({ account: signedIn, token }, { headers: { "Cache-Control": "no-store" } });
    (await cookies()).set(verikoraSessionCookie(token, expires));
    return Response.json({ account: signedIn });
  });
}
