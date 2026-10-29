

import { cloudFlow } from "@/app/cloud-flow";
import { accountAct } from "@/lib/account/act";
import { refuse } from "@/lib/http";
import { assertFeature, assertUserConnectors } from "@/lib/settings/guards";
import { beginConnection, isCloudName } from "@/lib/storage/cloud-connect";

export const dynamic = "force-dynamic";

/** « Connect my Dropbox / Google Drive / OneDrive »: the address of the provider's consent screen (PKCE; the verifier travels sealed in the state). The page then goes there. */
export const POST = (req: Request, ctx: { params: Promise<{ cloud: string }> }) =>
  accountAct(req, "storage-cloud", async (s) => {
    const { cloud } = await ctx.params;
    if (!isCloudName(cloud)) throw refuse(404, "CLOUD_NOT_OFFERED", "Unknown cloud");
    await assertFeature("ownStorage", s.account.id);
    await assertUserConnectors();
    const flow = cloudFlow();
    if (!flow) throw refuse(503, "SETTINGS_KEY_MISSING", "Connecting a cloud is not available on this deployment");
    return beginConnection(flow, s.account.id, cloud);
  });
