import { z } from "zod";

import { readJson } from "@/lib/http";
import { act } from "@/lib/organisation/api";
import { createLibrary, overview } from "@/lib/organisation/store";
import { libraryTags } from "@/lib/organisation/tag-list";

export const dynamic = "force-dynamic";

/** The libraries with their collections (file counts, tags) and the owner's tags: what the apps draw their library from. */
export const GET = (req: Request) =>
  act(req, async ({ owner, q }) => ({ libraries: await overview(q, owner), tags: await libraryTags(q, owner) }));

export const POST = (req: Request) =>
  act(
    req,
    async ({ owner, q }) => ({
      library: await createLibrary(q, owner, (await readJson(req, z.object({ name: z.string() }))).name),
    }),
    201,
  );
