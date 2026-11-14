import { systemClock } from "@/app/system-clock";
import { apiCaller } from "@/lib/api-v1/caller";
import { audit } from "@/lib/audit";
import { readBatchForm } from "@/lib/batch/form";
import { createBatch } from "@/lib/batch/run";
import { appEnvironment, documentsTenant } from "@/lib/env";
import { handle } from "@/lib/http";
import { limit } from "@/lib/limits";
import { assertFeature, settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

/** Starts a batch with an API key (`checks:write`): `manifest` (the CSV) and `files` (multipart), as on the web. */
export function POST(req: Request) {
  return handle(async () => {
    const caller = await apiCaller(req, "checks:write", systemClock);
    await assertFeature("batches", caller.account.id);
    await limit("batchCreate", req, caller.account.id);
    const form = await readBatchForm(req);
    const batch = await createBatch(caller.account, form.name, form.manifest, form.files, {
      settings: await settingsFor(caller.account.id),
      now: systemClock.now(),
      environment: appEnvironment(),
      tenant: documentsTenant(),
    });
    await audit({
      action: "api.batch.created",
      actorId: caller.account.id,
      actorLabel: `api-key:${caller.keyId}`,
      targetId: batch.id,
      detail: { rows: batch.items.length, refused: batch.counts.refused },
      headers: req.headers,
    });
    return Response.json({ batch }, { status: 201 });
  });
}
