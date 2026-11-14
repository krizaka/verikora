import { cookies } from "next/headers";

import { requestSessionToken } from "@/lib/access";
import { handle } from "@/lib/http";
import { revokeSession, SESSION_COOKIE } from "@/lib/session";

export function POST(req: Request) {
  return handle(async () => {
    await revokeSession(requestSessionToken(req.headers));
    (await cookies()).delete(SESSION_COOKIE);
    return new Response(null, { status: 204 });
  });
}
