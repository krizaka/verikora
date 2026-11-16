import { z } from "zod";

import { readJson } from "@/lib/http";
import { TAG_COLORS } from "@/lib/organisation/rules";
import { workspaceAct } from "@/lib/workspace/api";
import { KIND } from "@/lib/workspace/decl";
import { asTag } from "@/lib/workspace/tags";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };
const LIST = Promise.resolve({ kind: KIND.document });

export const PATCH = (req: Request, { params }: Params) =>
  workspaceAct(req, LIST, async ({ account, actor, workspace }) => {
    const { name, color } = await readJson(
      req,
      z.object({ name: z.string().optional(), color: z.enum(TAG_COLORS).optional() }),
    );
    const tag = await workspace.tags.update(account.id, actor, KIND.document, (await params).id, {
      name,
      marker: color,
    });
    return { tag: asTag(tag) };
  });
export const DELETE = (req: Request, { params }: Params) =>
  workspaceAct(req, LIST, async ({ account, actor, workspace }) => {
    await workspace.tags.remove(account.id, actor, KIND.document, (await params).id);
  });
