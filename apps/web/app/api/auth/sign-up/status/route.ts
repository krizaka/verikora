import { env } from "@/lib/env";
import { handle } from "@/lib/http";
import { signupOpenNow } from "@/lib/settings/signup";

export const dynamic = "force-dynamic";

/** Whether sign-up is open right now (the product's own setting, verikora#243): the public bar says « Try » or « Sign in » from it. Public, short-lived, nothing personal. */
export function GET() {
  return handle(async () =>
    Response.json({ open: await signupOpenNow(env()) }, { headers: { "Cache-Control": "public, max-age=60" } }),
  );
}
