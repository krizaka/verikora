import { cloudFlow } from "@/app/cloud-flow";
import { providers } from "@/app/storage-providers";
import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { handle, refuse } from "@/lib/http";
import { assertFeature, assertUserConnectors } from "@/lib/settings/guards";
import { completeConnection } from "@/lib/storage/cloud-connect";
import { CLOUD } from "@/lib/storage/cloud-connect";
import { registerCloud } from "@/lib/storage/own-providers";
import { actorOf } from "@/lib/storage/providers";
import { saveCloud } from "@/lib/storage/settings";

export const dynamic = "force-dynamic";

/** Where the provider sends the person back: the code is exchanged, the connection tested in the registry, then the person lands on Settings → Storage. A refusal (denied, expired, red test) lands there too, with its code, never a blank page. */
export const GET = (req: Request) =>
  handle(async () => {
    const session = await requireSession(req);
    const url = new URL(req.url);
    const back = (result: string) => Response.redirect(new URL(`/${session.account.locale}/app/settings/stockage?cloud=${encodeURIComponent(result)}`, env().APP_PUBLIC_URL), 303);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error") || !code || !state) return back("denied");
    try {
      await assertFeature("ownStorage", session.account.id);
      await assertUserConnectors();
      const flow = cloudFlow();
      const own = providers();
      if (!flow || !own) throw refuse(503, "SETTINGS_KEY_MISSING", "Connecting a cloud is not available on this deployment");
      const grant = await completeConnection(flow, session.account.id, { code, state });
      const connector = CLOUD[grant.cloud];
      const providerId = await registerCloud(own, actorOf(session.account), session.account.id, { connector, clientId: grant.clientId, clientSecret: grant.clientSecret, refreshToken: grant.refreshToken });
      await saveCloud(query, session.account.id, connector, providerId, new Date());
      await audit({ action: "storage.cloud_connected", actorId: session.account.id, actorLabel: session.account.email, targetId: session.account.id, detail: { cloud: connector }, headers: req.headers });
      return back("connected");
    } catch (error) {
      const code = (error as { body?: { code?: unknown } }).body?.code;
      return back(typeof code === "string" ? code : "failed");
    }
  });
