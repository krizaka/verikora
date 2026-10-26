import { appleAssociation } from "@/lib/app-links";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Apple's universal-links file, served as JSON without a redirect or an extension. Not served (404) until the signing team is set. */
export function GET() {
  const file = appleAssociation(readEnv().APP_IOS_TEAM_ID);
  if (!file) return new Response("Not found", { status: 404 });
  return Response.json(file, { headers: { "cache-control": "public, max-age=3600" } });
}
