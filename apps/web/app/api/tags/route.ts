import { z } from "zod";

import { readJson } from "@/lib/http";
import { TAG_COLORS } from "@/lib/organisation/rules";
import { workspaceAct } from "@/lib/workspace/api";
import { KIND } from "@/lib/workspace/decl";
import { asTag } from "@/lib/workspace/tags";

export const dynamic = "force-dynamic";

const LIST = Promise.resolve({ kind: KIND.document });

/**
 * The library's tag list as the first tags API read it (`{ id, name, color }`), answered from the one list (krizaka-internal#3994):
 * the same rows as `/api/organize/document/tags`. Kept for one release; the follow-up removes it.
 */
export const GET = (req: Request) =>
  workspaceAct(req, LIST, async ({ account, workspace }) => ({
    tags: (await workspace.tags.list(account.id, KIND.document)).map(asTag),
  }));
export const POST = (req: Request) =>
  workspaceAct(
    req,
    LIST,
    async ({ account, actor, workspace }) => {
      const input = await readJson(req, z.object({ name: z.string(), color: z.enum(TAG_COLORS) }));
      return {
        tag: asTag(
          await workspace.tags.create(account.id, actor, KIND.document, { name: input.name, marker: input.color }),
        ),
      };
    },
    { status: 201 },
  );
