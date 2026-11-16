import { z } from "zod";

import { readJson } from "@/lib/http";
import { workspaceAct } from "@/lib/workspace/api";
import { KIND } from "@/lib/workspace/decl";

export const dynamic = "force-dynamic";

/** Replaces the tags of a collection or a folder (the library's list). A document's: `PUT /api/organize/document/tags/set`. */
export const PUT = (req: Request) =>
  workspaceAct(req, Promise.resolve({ kind: KIND.collection }), async ({ account, actor, workspace }) => {
    const input = await readJson(
      req,
      z.object({ kind: z.enum([KIND.collection, KIND.folder]), id: z.string(), tagIds: z.array(z.string()).max(50) }),
    );
    await workspace.tags.set(account.id, actor, input.kind, input.id, input.tagIds);
  });
