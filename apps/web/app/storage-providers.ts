import { randomUUID } from "node:crypto";

import { type FetchLike, type OpenContext } from "@krizaka/storage";
import {
  createProviderService,
  dbProviderStore,
  type ProviderService,
  type ProviderStore,
} from "@krizaka/storage/provider-admin";

import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/log";
import { migrateOwnS3, type OwnProviders } from "@/lib/storage/own-providers";
import type { DocumentStore } from "@/lib/storage/port";
import type { MoveDeps } from "@/lib/storage/provider-move";
import { bootstrapStorage, DATA_KIND, documentsStoreOver, ORG_SCOPE, vaultFrom } from "@/lib/storage/providers";

import { systemClock } from "./system-clock";

/** The documents that name a provider: while some do, it can be neither disabled nor retired. */
const referencesOf = async (providerId: string) =>
  Number(
    (await query<{ n: string }>("SELECT count(*)::text AS n FROM documents WHERE provider_id = $1", [providerId]))[0]
      ?.n ?? 0,
  );

const holder = globalThis as unknown as {
  __verikoraProviders?: {
    service: ProviderService;
    store: ProviderStore;
    vault: NonNullable<ReturnType<typeof vaultFrom>>;
  } | null;
};

/** A deployed server (`NODE_ENV=production`) opens only the cloud kinds; a developer's machine and the tests may also open a folder. */
export const storageRuntime = (): "server" | "dev" => (process.env.NODE_ENV === "production" ? "server" : "dev");

/** What a candidate bucket is opened with for a test before it is saved: the same runtime and environment as the registry's own opens. */
export const openContextOf = (): OpenContext => ({
  runtime: storageRuntime(),
  environment: env().APP_ENVIRONMENT,
  fetch: fetch as unknown as FetchLike,
  clock: systemClock,
});

/** The provider service and its store, one per process (pages and routes are bundled apart); null when no vault key is deployed. */
export function providers(): OwnProviders | null {
  if (holder.__verikoraProviders !== undefined) return holder.__verikoraProviders;
  const e = env();
  const vault = vaultFrom(e);
  if (!vault) {
    holder.__verikoraProviders = null;
    return null;
  }
  const store = dbProviderStore(query);
  // A deployed server never writes its own disk (ADR-005 §5): the registry opens `folder` only in a development runtime.
  const runtime = storageRuntime();
  const service = createProviderService({
    store,
    vault,
    clock: systemClock,
    newId: randomUUID,
    open: { runtime, environment: e.APP_ENVIRONMENT, fetch: fetch as unknown as FetchLike, clock: systemClock },
    probeId: randomUUID,
    references: referencesOf,
    audit: (note) =>
      audit({
        action: note.action,
        actorId: note.actor.id,
        actorLabel: note.actor.label,
        targetId: note.target.id,
        detail: note.detail,
      }),
  });
  holder.__verikoraProviders = { service, store, vault };
  return holder.__verikoraProviders;
}

/** For tests: forget the cached service. */
export const resetProviders = () => {
  holder.__verikoraProviders = undefined;
};

/** The default store for a kind of data, or null (no vault key, no provider, or one that cannot be opened). */
export async function defaultStore(dataKind: string = DATA_KIND.documents): Promise<DocumentStore | null> {
  const p = providers();
  return p ? ((await documentsStoreOver(p.service, p.store, dataKind))?.store ?? null) : null;
}

/**
 * At start, after the migrations: imports the environment's provider once and gives the documents already in it their `provider_id`; then
 * moves the settings rows that still keep their own S3 secret into the registry's user scope (`migrateOwnS3`, idempotent).
 */
export async function bootstrapFromEnvironment(): Promise<string | null> {
  const p = providers();
  if (!p) return null;
  const imported = await bootstrapStorage(p.service, env());
  if (imported)
    await query(
      "UPDATE documents SET provider_id = $1 WHERE object_key IS NOT NULL AND provider_id IS NULL AND storage_owner = 'krizaka'",
      [imported.id],
    );
  const moved = await migrateOwnS3(query, p, systemClock.now());
  if (moved.left > 0)
    logError(
      `storage: ${moved.left} own S3 setting(s) could not be moved yet (incomplete, or sealed under a key this deployment does not hold)`,
    );
  return imported?.id ?? null;
}

/** What the move of documents between providers runs on (ADR-005 §3), or null when no vault key is deployed. */
export function moveDeps(): MoveDeps | null {
  const p = providers();
  if (!p) return null;
  return {
    q: query,
    service: p.service,
    defaults: () => p.store.defaults(ORG_SCOPE),
    audit: (note) =>
      audit({
        action: note.action,
        actorId: note.actor.id,
        actorLabel: note.actor.label,
        targetId: note.targetId,
        detail: note.detail,
      }),
    now: () => systemClock.now(),
  };
}
