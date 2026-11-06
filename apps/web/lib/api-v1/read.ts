import type { FlowEnvironment } from "@verikora/core";

import { systemClock } from "@/app/system-clock";

import { advanceBatch } from "../batch/run";
import { isUuid } from "../documents";
import { refuse } from "../http";
import { settingsFor } from "../settings/guards";
import { type ApiCaller, apiCaller } from "./caller";

/**
 * What a `GET /api/v1/{checks,batches}/{id}` shares (verikora#202): the key with `reports:read`, the id (a malformed one is a
 * 404, like an unknown one), and the batch advanced as it is read, like the web page does.
 */
export async function readAdvanced(
  req: Request,
  params: Promise<{ id: string }>,
  what: string,
  environment: FlowEnvironment,
) {
  const caller: ApiCaller = await apiCaller(req, "reports:read", systemClock);
  const id = (await params).id;
  if (!isUuid(id)) throw refuse(404, "NOT_FOUND", `No such ${what}`);
  const batch = await advanceBatch(caller.account, id, {
    settings: await settingsFor(caller.account.id),
    now: systemClock.now(),
    environment,
  });
  return { caller, batch };
}
