import { createProviderService, dbProviderStore } from "@krizaka/storage/provider-admin";
import { beforeAll, describe, expect, it } from "vitest";

import { migrate, query } from "../db";
import { storeDocument } from "../documents";
import { memoryStore } from "./memory";
import { bootstrapStorage, DATA_KIND, documentsStoreOver, ORG_SCOPE, type ProviderEnv } from "./providers";

/** ADR-005 on PostgreSQL: the environment bootstraps one provider, the database then chooses, a document records which provider holds it (skipped without the database test switch). */
const enabled = process.env.DATABASE_IT === "1" && !!process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-10-28T12:00:00Z");
const bootstrapEnv: ProviderEnv = {
  MEDIA_DOCUMENTS_PROVIDER: "bunny",
  MEDIA_DOCUMENTS_PREFIX: "verikora",
  MEDIA_STORAGE_ENDPOINT: "storage.bunnycdn.com",
  MEDIA_STORAGE_ZONE: "verikora-docs-dev",
  MEDIA_STORAGE_API_KEY: "zone-password",
  MEDIA_DOCUMENTS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};
const TEXT = "BAIL DE LOGEMENT\nLoyer mensuel : 1 450 $, payable le premier jour du mois.\n";

describe.runIf(enabled)("the storage providers in the database", () => {
  const providers = dbProviderStore(query);
  const service = createProviderService({
    store: providers,
    vault: { keyId: "media-1", key: KEY, ring: { keys: { "media-1": KEY } } },
    clock: { now: () => NOW },
    newId: () => crypto.randomUUID(),
    audit: async () => undefined,
    open: {
      runtime: "dev",
      environment: "dev",
      fetch: async () => new Response(null, { status: 200 }),
      clock: { now: () => NOW },
    },
    probeId: () => "probe",
    references: async (id) =>
      Number(
        (await query<{ n: string }>("SELECT count(*)::text AS n FROM documents WHERE provider_id = $1", [id]))[0]!.n,
      ),
  });

  beforeAll(async () => {
    await migrate();
    await query("DELETE FROM storage.default_provider");
    await query("DELETE FROM storage.provider");
  });

  it("imports the environment once, sets the defaults, and a new document records its provider", async () => {
    expect(await documentsStoreOver(service, providers)).toBeNull();
    const imported = (await bootstrapStorage(service, bootstrapEnv))!;
    expect(await providers.defaults(ORG_SCOPE)).toEqual({
      [DATA_KIND.documents]: imported.id,
      [DATA_KIND.avatars]: imported.id,
    });
    expect(await bootstrapStorage(service, bootstrapEnv)).toBeNull();

    const owner = (
      await query<{ id: string }>(
        "INSERT INTO accounts (email, password_hash, email_verified_at) VALUES ($1, 'x', now()) RETURNING id",
        [`p-${Math.random().toString(36).slice(2)}@verikora.test`],
      )
    )[0]!.id;
    const working = memoryStore({ kind: "none", devOnly: true, owner: "krizaka", residency: "elsewhere" });
    const { summary } = await storeDocument(
      owner,
      { name: "bail.txt", type: "text/plain", size: 100 },
      new TextEncoder().encode(TEXT),
      "lease",
      { keep: false, store: working, working, now: NOW, purgeAfterHours: 24 },
    );
    const [row] = await query<{ provider_id: string }>("SELECT provider_id FROM documents WHERE id = $1", [summary.id]);
    expect(row!.provider_id).toBe(imported.id);
  });

  it("refuses to disable a provider that is a default or that documents still reach", async () => {
    const [only] = await service.list(ORG_SCOPE);
    await expect(service.disable({ id: null, label: "t" }, only!.id)).rejects.toMatchObject({
      code: "STORAGE_PROVIDER_IN_USE",
    });
  });
});
