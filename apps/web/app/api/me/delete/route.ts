import { cookies } from "next/headers";
import { z } from "zod";

import { accountService } from "@/app/accounts-edge";
import { storesOf } from "@/app/active-store";
import { accountAct } from "@/lib/account/act";
import { eraseAccount } from "@/lib/account/data";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { readJson, refuse } from "@/lib/http";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** « Delete my account » (Loi 25, erasure): the password and the typed address are checked; the kept files, the data and the identity go at once. */
export const POST = (req: Request) => accountAct(req, "delete-account", async (s) => {
  const input = await readJson(req, z.object({ password: z.string().min(1).max(256), email: z.string().trim().toLowerCase() }));
  if (input.email !== s.account.email) throw refuse(400, "EMAIL_MISMATCH", "Type your e-mail address to confirm");
  const accounts = accountService();
  await accounts.confirmPassword(s.account.id, input.password);
  const stores = await storesOf(s.account.id);
  await eraseAccount({ query, stores: stores.of }, s.account.id);
  await audit({ action: "account.deleted", actorId: null, actorLabel: "deleted account", headers: req.headers });
  (await cookies()).delete(SESSION_COOKIE);
  return { ok: true };
});
