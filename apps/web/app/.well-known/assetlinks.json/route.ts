import { assetLinks } from "@/lib/app-links";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Android's digital asset links for the app's links. Not served (404) until the signing certificate's fingerprint is set. */
export function GET() {
  const file = assetLinks(readEnv().APP_ANDROID_CERT_SHA256);
  if (!file) return new Response("Not found", { status: 404 });
  return Response.json(file, { headers: { "cache-control": "public, max-age=3600" } });
}
