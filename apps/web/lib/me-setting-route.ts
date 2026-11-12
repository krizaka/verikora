import { z } from "zod";

import { requireSession } from "./access";
import { audit } from "./audit";
import { handle, readJson } from "./http";
import { limit } from "./limits";
import type { Session } from "./session";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * `GET`/`PUT /api/me/<field>`: one account setting chosen from a closed set — read from the session, changed under the
 * `perspective` rate limit, written by `write`, and audited as `profile.<field>_set` with its old and new value.
 */
export function accountSettingRoute<K extends string, V extends string>(config: {
  field: K;
  schema: z.ZodType<V>;
  read: (account: Session["account"]) => V | null;
  write: (accountId: string, value: V) => Promise<void>;
}) {
  const { field, schema, read, write } = config;
  return {
    GET: (req: Request) =>
      handle(async () => {
        const session = await requireSession(req);
        return Response.json({ [field]: read(session.account) }, { headers: NO_STORE });
      }),
    PUT: (req: Request) =>
      handle(async () => {
        const session = await requireSession(req);
        await limit("perspective", req, session.account.id);
        const value = (await readJson(req, z.object({ [field]: schema })))[field] as V;
        await write(session.account.id, value);
        await audit({
          action: `profile.${field}_set`,
          actorId: session.account.id,
          actorLabel: session.account.email,
          targetId: session.account.id,
          detail: { from: read(session.account), to: value },
          headers: req.headers,
        });
        return Response.json({ [field]: value }, { headers: NO_STORE });
      }),
  };
}
