import {
  AvatarImageError,
  type AvatarProcessor,
  createOrganize,
  type ObjectStore,
  OrganizeError,
  type OrganizeSchema,
} from "@krizaka/organize";

import { inspectUpload } from "../documents";
import { refuse } from "../http";
import { type PhotoKind, squareAvatar } from "../images";
import { VERIKORA_RULES } from "../preflight/rules";
import type { Query } from "./store";

/**
 * « organize » for Verikora (ADR-006, `@krizaka/organize`): the collections' default and avatar, and the tags, come from the package.
 * Libraries, folders, where a document sits and the counts stay Verikora's own levels on top. The documents' tags are the workspace's
 * (`lib/workspace`, verikora#324): markers, bulk tagging and the filter live there; this layer keeps the collections' and folders'.
 */
export const ORGANIZE_SCHEMA: OrganizeSchema = {
  collectionTags: "collections_tags",
  kinds: {
    folder: {
      table: "folders",
      tagTable: "folder_tags",
      tagColumn: "folder_id",
      inCollection: false,
      owns: "EXISTS (SELECT 1 FROM collections c WHERE c.id = e.collection_id AND c.owner_id = $1)",
    },
  },
};

const IMAGE_KINDS = ["png", "jpeg", "heic"] as const;

/** The avatar's image maker: the pre-flight (type by its bytes, size, pixels), then square, upright, without metadata. */
export function avatarProcessor(maxBytes: number, size: number): AvatarProcessor {
  return {
    async process(file) {
      const { fileKind } = await inspectUpload(
        { name: file.name, type: file.type, size: file.bytes.length },
        file.bytes,
        { ...VERIKORA_RULES, maxBytes, allowedKinds: IMAGE_KINDS },
      ).catch((error: { status?: number; body?: { code?: string } }) => {
        throw new AvatarImageError(error.status ?? 422, error.body?.code ?? "UNREADABLE_IMAGE");
      });
      try {
        return {
          bytes: await squareAvatar({ bytes: file.bytes, kind: fileKind as PhotoKind }, size),
          contentType: "image/jpeg",
        };
      } catch {
        throw new AvatarImageError(422, "UNREADABLE_IMAGE");
      }
    },
  };
}

/** Where Verikora kept an avatar image before the package: read as a fallback, never written. */
export const legacyAvatarKey = (_kind: string, owner: string, id: string, version: number) =>
  `${owner}/${id}/${version}.jpg`;

/** The store is the product's (`DocumentStore`); the image maker is built for the limits of the call. */
export function organizeOver(q: Query, images?: { store: ObjectStore }, maxBytes = 0, size = 256) {
  return createOrganize({
    query: (sql, params) => q(sql, params) as Promise<never>,
    schema: ORGANIZE_SCHEMA,
    images: images && { store: images.store, processor: avatarProcessor(maxBytes, size) },
    legacyAvatarKey,
  });
}

/** The package's refusals become Verikora's HTTP answers (the same codes the pages translate). */
export async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OrganizeError)
      throw refuse(error.status, /^[A-Z_]+$/.test(error.message) ? error.message : error.code, error.message);
    throw error;
  }
}
