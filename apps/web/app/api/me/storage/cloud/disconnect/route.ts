import { cloudFlow } from "@/app/cloud-flow";
import { providers } from "@/app/storage-providers";
import { accountAct } from "@/lib/account/act";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { CLOUD, CLOUD_NAMES, revokeGrant } from "@/lib/storage/cloud-connect";
import { forgetGrant, storedRefreshToken } from "@/lib/storage/own-providers";
import { ownProviderId, saveDisconnected } from "@/lib/storage/settings";

export const dynamic = "force-dynamic";

/**
 * « Disconnect »: the grant is revoked at the cloud where it allows, the sealed token is forgotten here, new documents go back to Krizaka's
 * store. The files stay in their cloud; the documents that name it say `STORAGE_DISCONNECTED` until the person connects it again.
 */
export const POST = (req: Request) =>
  accountAct(req, "storage-cloud", async (s) => {
    const owner = s.account.id;
    const own = providers();
    const { providerId, connector } = await ownProviderId(query, owner);
    const name = CLOUD_NAMES.find((n) => CLOUD[n] === connector);
    if (own && providerId && name) {
      const token = await storedRefreshToken(own, providerId).catch(() => null);
      const flow = cloudFlow();
      const revoked = flow && token ? await revokeGrant(flow, name, token) : false;
      await forgetGrant(own, providerId, new Date());
      await audit({ action: "storage.cloud_disconnected", actorId: owner, actorLabel: s.account.email, targetId: owner, detail: { cloud: connector, revoked }, headers: req.headers });
    }
    return { settings: await saveDisconnected(query, owner, new Date()) };
  });
