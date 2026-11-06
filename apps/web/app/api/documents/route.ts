import { type DocumentKind, documentKind, STORAGE_MODE } from "@verikora/core";
import { after } from "next/server";
import { z } from "zod";

import { storeForDocument, storesOf, workingStore } from "@/app/active-store";
import { requireSession } from "@/lib/access";
import { assertUploadForApplication, attachToApplication } from "@/lib/applicant-consent";
import { audit } from "@/lib/audit";
import { query } from "@/lib/db";
import { listDocuments, storeDocument } from "@/lib/documents";
import { handle, HttpError, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { isId } from "@/lib/organisation/rules";
import { placeDocument } from "@/lib/organisation/store";
import { isPhoto, storePhotos } from "@/lib/photos";
import { VERIKORA_RULES } from "@/lib/preflight/rules";
import { recordPreflight } from "@/lib/preflight-events";
import { preflightRulesFrom } from "@/lib/settings/boundary";
import { assertFeature, settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    return Response.json({ documents: await listDocuments(session.account.id) });
  });
}

type Stores = Awaited<ReturnType<typeof storesOf>>;
type Stored = Awaited<ReturnType<typeof storeDocument>>;
const stringField = (form: FormData | null, name: string) => {
  const value = form?.get(name);
  return typeof value === "string" ? value : null;
};

/** Where it may be kept is the owner's setting: « conserver » is refused while keeping is switched off (ADR-0007). */
async function keepRequest(form: FormData | null, accountId: string): Promise<{ keep: boolean; stores: Stores }> {
  const stores = await storesOf(accountId);
  const keep = form?.get("keep") === "true";
  if (keep) await assertFeature("keepDocuments", accountId);
  if (keep && stores.settings.mode === STORAGE_MODE.none)
    throw refuse(409, "KEEP_DISABLED", "Keeping documents is switched off for this account");
  return { keep, stores };
}

/** Stores the upload (one document, or several photos as one); a file the pre-flight refused is an engine run that did not happen (counted per tenant). */
async function storeUpload(
  accountId: string,
  upload: {
    files: File[];
    bytes: Uint8Array;
    photos: boolean;
    kind: DocumentKind | "auto";
    keep: boolean;
    stores: Stores;
  },
): Promise<Stored> {
  const { files, bytes, photos, kind, keep, stores } = upload;
  const file = files[0]!;
  const settings = await settingsFor(accountId);
  try {
    const policy = {
      keep,
      store: stores.write,
      working: await workingStore(),
      now: new Date(),
      purgeAfterHours: settings["limits.purgeAfterHours"].value as number,
      rules: preflightRulesFrom(VERIKORA_RULES, settings),
    };
    return photos
      ? await storePhotos(
          accountId,
          await Promise.all(
            files.map(async (f, i) => ({
              name: f.name,
              type: f.type,
              bytes: i === 0 ? bytes : new Uint8Array(await f.arrayBuffer()),
            })),
          ),
          kind,
          { policy },
        )
      : await storeDocument(
          accountId,
          { name: file.name, type: file.type, size: file.size },
          bytes,
          kind,
          policy,
          undefined,
          { defer: true },
        );
  } catch (error) {
    const reason = error instanceof HttpError ? error.body.reason : undefined;
    if (typeof reason === "string") await recordPreflight(query, accountId, "rejected", reason);
    throw error;
  }
}

/** Uploaded from a collection or a folder: it lands there (ADR-0007). */
async function placeUpload(accountId: string, documentId: string, form: FormData | null): Promise<void> {
  const collectionId = stringField(form, "collectionId");
  const folderId = stringField(form, "folderId");
  if (collectionId && isId(collectionId))
    await placeDocument(query, accountId, documentId, {
      collectionId,
      folderId: folderId && isId(folderId) ? folderId : null,
    });
}

/** One file per request (multipart, field `file`; `kind` optional). 60 uploads per account per hour. A new PDF or text file answers 202 Accepted `QUEUED`: its text is read after the answer. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    const accountId = session.account.id;
    await limit("upload", req, accountId);
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
    const file = files[0];
    if (!file) throw refuse(400, "BAD_REQUEST", "A file is expected in the field `file`");
    const kind = documentKind
      .or(z.literal("auto"))
      .catch("auto")
      .parse(form?.get("kind") ?? "auto");
    // A document for an application (« screeningId ») is accepted only with the applicant's consent to the document check (verikora#131), before any byte is stored.
    const screeningId = stringField(form, "screeningId");
    if (screeningId !== null) await assertUploadForApplication(accountId, screeningId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Photos (by their bytes, not their names) are cleaned and read locally, and several make ONE document (ADR-0010).
    const photos = isPhoto(bytes);
    if (files.length > 1 && !photos)
      throw refuse(400, "BAD_REQUEST", "One PDF or text file per request; several photos make one document");
    const { keep, stores } = await keepRequest(form, accountId);
    const { summary, duplicate, finish } = await storeUpload(accountId, { files, bytes, photos, kind, keep, stores });
    if (screeningId !== null)
      await attachToApplication(accountId, summary.id, screeningId, await storeForDocument(accountId, summary.id));
    if (!duplicate) {
      await placeUpload(accountId, summary.id, form);
      await recordPreflight(query, accountId, "accepted");
      await audit({
        action: "document.uploaded",
        actorId: accountId,
        actorLabel: session.account.email,
        targetId: summary.id,
        detail: { size: summary.sizeBytes, mime: summary.mimeType },
        headers: req.headers,
      });
    }
    // 202 Accepted: the file is stored and checked by the pre-flight; its text is read by an isolated worker after this answer (verikora#21).
    if (finish) {
      after(finish);
      return Response.json({ document: summary, duplicate, status: "QUEUED" }, { status: 202 });
    }
    return Response.json({ document: summary, duplicate }, { status: duplicate ? 200 : 201 });
  });
}
