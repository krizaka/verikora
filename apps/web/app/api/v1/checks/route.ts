import { systemClock } from "@/app/system-clock";
import { apiCaller } from "@/lib/api-v1/caller";
import { checkView } from "@/lib/api-v1/checks";
import { audit } from "@/lib/audit";
import { readCheckForm } from "@/lib/batch/form";
import { createBatch } from "@/lib/batch/run";
import { appEnvironment, documentsTenant } from "@/lib/env";
import { handle } from "@/lib/http";
import { settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

/** Starts one check with an API key (`checks:write`): `file`, `check`, `reference` (multipart). 201 with the check, or its refusal. */
export function POST(req: Request) {
  return handle(async () => {
    const caller = await apiCaller(req, "checks:write", systemClock);
    const form = await readCheckForm(req);
    const batch = await createBatch(caller.account, form.name, form.manifest, form.files, {
      settings: await settingsFor(caller.account.id),
      now: systemClock.now(),
      environment: appEnvironment(),
      tenant: documentsTenant(),
    });
    const check = checkView(batch);
    await audit({
      action: "api.check.created",
      actorId: caller.account.id,
      actorLabel: `api-key:${caller.keyId}`,
      targetId: check.id,
      detail: { state: check.state, error: check.error },
      headers: req.headers,
    });
    return Response.json({ check }, { status: 201 });
  });
}
