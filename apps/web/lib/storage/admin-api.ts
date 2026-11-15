import { randomBytes } from "node:crypto";

import { PROVIDER_KINDS, type ProviderKind, STORAGE_CODE, StorageError } from "@krizaka/storage";
import type { Actor, ProviderService, PublicProvider } from "@krizaka/storage/provider-admin";
import { z } from "zod";

import { type HttpError, refuse } from "../http";
import type { MoveView } from "./provider-move";
import { DATA_KIND, ORG_SCOPE } from "./providers";

/** What the admin may type: a kind, a label, the non-secret coordinates and the secrets (entered once, never returned). */
export const createProviderInput = z.object({
  kind: z.string().trim().min(1).max(40),
  preset: z.string().trim().max(40).optional(),
  label: z.string().trim().min(1).max(80),
  coordinates: z.record(z.string().max(200), z.string().trim().max(300)).default({}),
  credentials: z.record(z.string().max(200), z.string().max(500)).default({}),
});
export const changeKeyInput = z.object({
  credentials: z
    .record(z.string().max(200), z.string().min(1).max(500))
    .refine(
      (c) => Object.keys(c).length > 0 && !("encryptionKey" in c),
      "at least one credential, never the object-encryption key (the stored objects would no longer open)",
    ),
});
export const setDefaultInput = z.object({
  dataKind: z.enum([DATA_KIND.documents, DATA_KIND.avatars, DATA_KIND.backups]),
});

/** A kind as the screen draws its form: the fields, never a value. */
export interface KindForm {
  kind: string;
  devOnly: boolean;
  coordinates: ProviderKind["coordinates"];
  credentials: ProviderKind["credentials"];
  presets: { id: string; endpointTemplate: string | null; regions: readonly string[] }[];
}

/** Kinds the package offers that this app does not expose to its admins yet (the managed kind arrived with @krizaka/storage 0.11; offering it is a product decision, krizaka-internal#3630). */
const NOT_OFFERED: ReadonlySet<string> = new Set(["managed"]);

/** The kinds an admin may add here: implemented, for the admin, openable by this runtime, and not a dev-only kind in production. */
export function adminKinds(runtime: "server" | "dev", environment: "dev" | "prod"): KindForm[] {
  return PROVIDER_KINDS.filter(
    (k) =>
      k.implemented &&
      !NOT_OFFERED.has(k.kind) &&
      k.scopes.includes("admin") &&
      k.runtimes.includes(runtime) &&
      !(k.devOnly && environment === "prod"),
  ).map((k) => ({
    kind: k.kind,
    devOnly: k.devOnly,
    coordinates: k.coordinates,
    credentials: k.credentials,
    presets: (k.presets ?? []).map((p) => ({ id: p.id, endpointTemplate: p.endpointTemplate, regions: p.regions })),
  }));
}

/** The package's refusals as the HTTP answers they deserve. Recognised by name and code, not `instanceof` (two copies of a class can meet in one process). */
const STATUS: Record<string, number> = {
  [STORAGE_CODE.notFound]: 404,
  [STORAGE_CODE.inUse]: 409,
  [STORAGE_CODE.notVerified]: 409,
  [STORAGE_CODE.badConfig]: 400,
  [STORAGE_CODE.badEndpoint]: 400,
  [STORAGE_CODE.badSecretKey]: 400,
  [STORAGE_CODE.testFailed]: 422,
};
export function storageRefusal(error: unknown): HttpError | null {
  const e = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || (e.name !== "StorageError" && !(error instanceof StorageError)) || typeof e.code !== "string") {
    return null;
  }
  return refuse(STATUS[e.code] ?? 502, e.code, typeof e.message === "string" ? e.message : e.code);
}

/** The same call, with the package's refusals turned into HTTP ones. */
export async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw storageRefusal(error) ?? error;
  }
}

/** The screen's one read: the providers (secrets are `set` or `not set`, nothing else), which one is the default of each kind of data, the kinds the form offers, and the move of documents between providers (counts only). */
export async function overview(
  service: ProviderService,
  defaults: () => Promise<Record<string, string>>,
  kinds: KindForm[],
  move: () => Promise<MoveView | null> = async () => null,
) {
  return { providers: await service.list(ORG_SCOPE), defaults: await defaults(), kinds, move: await move() };
}

/** Adds a provider as a draft and tests it at once; the object-encryption key is generated here when the admin gives none (every document is encrypted before it leaves). */
export async function addProvider(
  service: ProviderService,
  actor: Actor,
  input: z.infer<typeof createProviderInput>,
): Promise<PublicProvider> {
  const credentials = {
    ...input.credentials,
    ...(input.credentials.encryptionKey ? {} : { encryptionKey: randomBytes(32).toString("base64") }),
  };
  const created = await guarded(() =>
    service.create(actor, {
      scope: ORG_SCOPE,
      kind: input.kind,
      ...(input.preset ? { preset: input.preset } : {}),
      label: input.label,
      coordinates: input.coordinates,
      credentials,
    }),
  );
  return guarded(() => service.test(actor, created.id));
}

/** The providers of this deployment, or a 503 that says why there are none to manage: storing credentials needs the vault key. */
export function managedProviders<T>(get: () => T | null): T {
  const p = get();
  if (!p) {
    throw refuse(
      503,
      "STORAGE_VAULT_MISSING",
      "Storing credentials is not available on this deployment: MEDIA_VAULT_KEY is not set",
    );
  }
  return p;
}

/**
 * In production, the documents are kept in Canada (Loi 25 art. 17, ADR-005): a provider becomes their default only when its last connection
 * test went through AND found a Canadian region. Development holds fictional data only and stays free; the avatars are not documents.
 */
export function assertDefaultResidency(
  environment: "dev" | "prod",
  provider: Pick<PublicProvider, "lastTest"> | undefined,
  dataKind: string,
): void {
  if (environment !== "prod" || dataKind !== DATA_KIND.documents) {
    return;
  }
  const found = provider?.lastTest;
  if (found?.ok && found.residency.key.startsWith("canada")) {
    return;
  }
  throw refuse(
    409,
    "STORAGE_NOT_IN_CANADA",
    "In production the documents are kept in Canada: test this provider and check that its region is Canadian first",
  );
}

/** The two ids of a move: the retiring provider the documents leave, the default they go to. */
export const startMoveInput = z.object({ from: z.string().uuid(), to: z.string().uuid() });
