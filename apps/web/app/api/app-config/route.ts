import { createAppConfigHandler } from "@krizaka/app-config/server";

import { appConfigRecord } from "@/lib/app-config";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The app-version contract of `@krizaka/app-config` (verikora, krizaka-internal#2405): public, cacheable for a minute (ETag, 304), no
 * personal data. `flags.signupOpen` is the sign-up setting, read by the one function the sign-up page and route use.
 */
export const GET = createAppConfigHandler({
  store: { get: (platform) => appConfigRecord(platform, env()) },
  maxAgeSeconds: 60,
});
