import { AVATAR_KIND } from "@verikora/core";

import { avatarStore } from "@/app/active-store";
import { requireSession } from "@/lib/access";
import { query } from "@/lib/db";
import { handle, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { act, type Params } from "@/lib/organisation/api";
import { readAvatar, removeAvatar, uploadAvatar } from "@/lib/organisation/avatar";
import { ownedCollection } from "@/lib/organisation/store";
import { assertFeature, settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

// @fixed: the side of the stored square, in pixels — the largest the library draws (a retina card), not a business parameter
const AVATAR_SIDE = 256;

/**
 * An uploaded avatar, to the owner only. With a store that hands out signed links the answer redirects to one (a minute or two
 * of life); otherwise the image is served from here. The address carries `?v=<version>`: a new image is a new address.
 */
export function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    const owner = session.account.id;
    const id = (await params).id;
    const store = await avatarStore();
    if (!store) throw refuse(404, "NOT_FOUND", "No avatar image");
    const collection = await ownedCollection(query, owner, id);
    if (collection.avatar?.kind !== AVATAR_KIND.image) throw refuse(404, "NOT_FOUND", "No avatar image");
    const image = await readAvatar(query, owner, id, store);
    if (!image) throw refuse(404, "NOT_FOUND", "No avatar image");
    return new Response(Buffer.from(image.bytes), {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

/** Uploads the image (multipart, field `file`): checked, made square without metadata, kept under its own prefix. */
export const POST = (req: Request, { params }: Params) =>
  act(
    req,
    async ({ owner, q, note }) => {
      await limit("avatar", req, owner);
      await assertFeature("collectionAvatars", owner);
      const store = await avatarStore();
      if (!store) throw refuse(503, "AVATAR_STORAGE_OFF", "No storage is configured for avatar images");
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) throw refuse(400, "BAD_REQUEST", "An image is expected in the field `file`");
      const id = (await params).id;
      const settings = await settingsFor(owner);
      const avatar = await uploadAvatar(
        q,
        owner,
        id,
        { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
        {
          allowedSeeds: settings["features.avatarSet"].value as string[],
          maxBytes: (settings["limits.avatarMaxKb"].value as number) * 1024,
          size: AVATAR_SIDE,
          store,
        },
      );
      await note("collection.avatar_uploaded", {
        id,
        version: avatar.kind === AVATAR_KIND.image ? avatar.version : null,
      });
      return { avatar };
    },
    201,
  );

/** No avatar: an uploaded image is deleted from its store. */
export const DELETE = (req: Request, { params }: Params) =>
  act(req, async ({ owner, q, note }) => {
    const id = (await params).id;
    await removeAvatar(q, owner, id, (await avatarStore()) ?? undefined);
    await note("collection.avatar_removed", { id });
  });
