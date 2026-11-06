import { z } from "zod";

import { systemClock } from "@/app/system-clock";
import { accountAct } from "@/lib/account/act";
import { apiKeys, assertKeysAllowed, keyAct, maxActiveKeys } from "@/lib/api-access";
import { VERIKORA_API_KEY_RULES } from "@/lib/api-keys";
import { audit } from "@/lib/audit";
import { readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The person's keys: name, the start of the key, scopes, dates, status — never a secret or a hash — and what their plan allows. */
export const GET = (req: Request) =>
  accountAct(req, "api-keys", async (s) => {
    const keys = apiKeys(systemClock);
    return {
      keys: (await keys.list(s.account.id)).map((k) => keys.publicView(k)),
      scopes: VERIKORA_API_KEY_RULES.scopes,
      maxActive: await maxActiveKeys(s.account.id, systemClock.now()),
      maxExpiryDays: VERIKORA_API_KEY_RULES.maxExpiryDays,
    };
  });

/** Creates a key: the whole key is in this answer and nowhere else, ever. */
export const POST = (req: Request) =>
  accountAct(req, "api-keys", async (s) => {
    const input = await readJson(
      req,
      z.object({
        name: z.string().max(200),
        scopes: z.array(z.string()).max(20),
        expiresInDays: z.number().int().nullable(),
      }),
    );
    const maxActive = await assertKeysAllowed(s.account.id, systemClock.now());
    const keys = apiKeys(systemClock);
    const { key, record } = await keyAct(() => keys.create(s.account.id, input, { maxActive }));
    await audit({
      action: "apikey.created",
      actorId: s.account.id,
      actorLabel: s.account.email,
      targetId: record.id,
      detail: { name: record.name, scopes: record.scopes, expiresAt: record.expiresAt },
      headers: req.headers,
    });
    return new Response(JSON.stringify({ key, apiKey: keys.publicView(record) }), {
      status: 201,
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  });
