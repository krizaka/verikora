import { providers } from "@/app/storage-providers";
import { requireAdmin } from "@/lib/access";
import { appEnvironment } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { assertDefaultResidency, guarded, managedProviders, setDefaultInput } from "@/lib/storage/admin-api";
import { actorOf, ORG_SCOPE } from "@/lib/storage/providers";

export const dynamic = "force-dynamic";

/** Makes a verified provider the default for a kind of data: new writes go there, the previous default keeps reading. Audited. */
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const session = await requireAdmin(req);
    const { id } = await ctx.params;
    const input = await readJson(req, setDefaultInput);
    const { service } = managedProviders(providers);
    assertDefaultResidency(
      appEnvironment(),
      (await service.list(ORG_SCOPE)).find((p) => p.id === id),
      input.dataKind,
    );
    return Response.json({
      provider: await guarded(() => service.setDefault(actorOf(session.account), id, ORG_SCOPE, input.dataKind)),
    });
  });
