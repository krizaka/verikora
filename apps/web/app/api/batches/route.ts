import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { readBatchForm } from "@/lib/batch/form";
import { createBatch, listBatches } from "@/lib/batch/run";
import { appEnvironment } from "@/lib/env";
import { handle } from "@/lib/http";
import { limit } from "@/lib/limits";
import { assertFeature, settingsFor } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

/** The account's batches, newest first (verikora#232). */
export function GET(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    return Response.json({ batches: await listBatches(session.account.id) });
  });
}

/** Creates a batch from `manifest` (the CSV) and `files` (multipart), stores its documents and starts the first rows. */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    await assertFeature("batches", session.account.id);
    await limit("batchCreate", req, session.account.id);
    const form = await readBatchForm(req);
    const batch = await createBatch(session.account, form.name, form.manifest, form.files, {
      settings: await settingsFor(session.account.id),
      now: new Date(),
      environment: appEnvironment(),
    });
    await audit({
      action: "batch.created",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: batch.id,
      detail: { rows: batch.items.length, refused: batch.counts.refused },
      headers: req.headers,
    });
    return Response.json({ batch }, { status: 201 });
  });
}
