import crypto from "node:crypto";

import { STORAGE_MODE, STORAGE_MODES } from "@yomizaka/core";
import { z } from "zod";

import { cloudsOffered } from "@/app/cloud-flow";
import { s3Body, secretFor } from "@/app/own-s3";
import { openContextOf, providers } from "@/app/storage-providers";
import { accountAct } from "@/lib/account/act";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { readJson, refuse } from "@/lib/http";
import { assertFeature } from "@/lib/settings/guards";
import { actorOf } from "@/lib/storage/providers";
import { loadSettings, saveSettings } from "@/lib/storage/settings";
import { verifyS3 } from "@/lib/storage/verify";


export const dynamic = "force-dynamic";

export const GET = (req: Request) => accountAct(req, "storage", async (s) => ({ settings: await loadSettings(query, s.account.id), canStoreCredentials: providers() !== null, clouds: await cloudsOffered() }));

/**
 * Saves where kept documents live: none, Krizaka's store, or the owner's own S3. An own S3 is verified (public https address,
 * then write / read / delete) before it is saved, and cannot be left or changed while documents are kept on it.
 */
export const PUT = (req: Request) => accountAct(req, "storage", async (s) => {
  const input = await readJson(req, z.object({ mode: z.enum(STORAGE_MODES), keepDefault: z.boolean(), s3: s3Body.optional() }));
  const owner = s.account.id;
  const current = await loadSettings(query, owner);
  if (input.mode === STORAGE_MODE.cloud && current.mode !== STORAGE_MODE.cloud) throw refuse(400, "BAD_REQUEST", "A cloud is connected from its provider's page, not saved");
  const leaving = (current.mode === STORAGE_MODE.cloud && input.mode !== STORAGE_MODE.cloud) || current.mode === STORAGE_MODE.s3 && (input.mode !== STORAGE_MODE.s3 || input.s3?.endpoint.replace(/\/$/, "") !== current.s3?.endpoint || input.s3?.bucket !== current.s3?.bucket);
  if (leaving) {
    const [inUse] = await query("SELECT 1 FROM documents WHERE owner_id = $1 AND storage_owner = 'workspace' AND storage <> 'none' LIMIT 1", [owner]);
    if (inUse) throw refuse(409, "STORAGE_IN_USE", "Documents are kept on this storage: export or delete them first");
  }
  let s3;
  if (input.mode === STORAGE_MODE.s3) {
    await assertFeature("ownStorage", owner);
    if (!input.s3) throw refuse(400, "BAD_REQUEST", "The S3 settings are required");
    const secretAccessKey = await secretFor(owner, input.s3.secretAccessKey);
    const v = await verifyS3({ ...input.s3, secretAccessKey }, { ctx: openContextOf(), probeId: crypto.randomUUID() });
    if (v.error) throw refuse(422, v.error, "This endpoint is not allowed");
    if (!v.ok) throw refuse(422, "CONNECTION_FAILED", "The connection test failed", { steps: v.steps });
    s3 = { ...input.s3, endpoint: v.origin! };
  }
  const settings = await saveSettings(query, owner, { mode: input.mode, keepDefault: input.keepDefault, s3 }, providers(), actorOf({ id: owner, email: s.account.email }), new Date());
  await audit({ action: "storage.settings_changed", actorId: owner, actorLabel: s.account.email, targetId: owner, detail: { mode: settings.mode, host: settings.s3 ? new URL(settings.s3.endpoint).host : null }, headers: req.headers });
  return { settings };
});
