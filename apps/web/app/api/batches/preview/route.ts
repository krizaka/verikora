import { requireSession } from "@/lib/access";
import { previewBatch } from "@/lib/batch/preview";
import { handle, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { assertFeature, settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

/**
 * The preview of a batch (verikora#232): `manifest` (the CSV) and `files` (the documents it names), as multipart. Answers
 * row by row what would be checked, reused or refused, and the audits it costs — nothing is stored, nothing runs.
 */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await assertFeature("batches", session.account.id);
    await limit("batchPreview", req, session.account.id);
    const form = await req.formData().catch(() => null);
    const manifest = form?.get("manifest");
    if (!(manifest instanceof File) && typeof manifest !== "string")
      throw refuse(400, "BAD_REQUEST", "A CSV is expected in the field `manifest`");
    const text = typeof manifest === "string" ? manifest : await manifest.text();
    const files = await Promise.all(
      (form?.getAll("files") ?? [])
        .filter((f): f is File => f instanceof File)
        .map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );
    return Response.json(
      await previewBatch(session.account.id, text, files, await settingsFor(session.account.id), new Date()),
    );
  });
}
