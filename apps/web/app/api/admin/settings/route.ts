import { z } from "zod";

import { requireAdmin } from "@/lib/access";
import { handle, readJson } from "@/lib/http";
import { describeVerikoraSettings } from "@/lib/settings/describe";
import { appSettings } from "@/lib/settings/instance";
import { settingsRefusal } from "@/lib/settings/refusal";
import { SCOPE } from "@/lib/settings/registry";
import { type ScopeRef } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

const scope = z.object({
  scope: z.enum([SCOPE.global, SCOPE.workspace, SCOPE.user]),
  id: z.string().max(80).default(""),
});
const asRef = ({ scope: s, id }: z.infer<typeof scope>): ScopeRef => ({ scope: s, id: s === SCOPE.global ? "" : id });

/** The administration's own errors: a refused value, setting or scope answers with its code, never a 500. */
async function run(fn: () => Promise<Response>) {
  return handle(async () => {
    try {
      return await fn();
    } catch (error) {
      const refusal = settingsRefusal(error);
      if (refusal) throw refusal;
      throw error;
    }
  });
}

/** What is set at a scope, what applies there (with where it comes from), and what can be set. ADMIN role and allowed address only. */
export const GET = (req: Request) =>
  run(async () => {
    await requireAdmin(req);
    const url = new URL(req.url);
    const ref = asRef(
      scope.parse({ scope: url.searchParams.get("scope") ?? SCOPE.global, id: url.searchParams.get("id") ?? "" }),
    );
    const service = appSettings();
    const contextOf = () => {
      if (ref.scope === SCOPE.user) return { userId: ref.id };
      if (ref.scope === SCOPE.workspace) return { workspaceId: ref.id };
      return {};
    };
    const context = contextOf();
    return Response.json(
      {
        definitions: describeVerikoraSettings(),
        overrides: await service.overrides(ref),
        effective: await service.snapshot(context),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });

const change = scope.extend({ key: z.string().max(80), value: z.unknown() });
export const PUT = (req: Request) =>
  run(async () => {
    const session = await requireAdmin(req);
    const input = await readJson(req, change);
    await appSettings().set(
      { id: session.account.id, label: session.account.email },
      asRef(input),
      input.key,
      input.value,
      new Date(),
    );
    return Response.json({ ok: true });
  });

export const DELETE = (req: Request) =>
  run(async () => {
    const session = await requireAdmin(req);
    const input = await readJson(req, scope.extend({ key: z.string().max(80) }));
    await appSettings().reset(
      { id: session.account.id, label: session.account.email },
      asRef(input),
      input.key,
      new Date(),
    );
    return Response.json({ ok: true });
  });
