import { startAnalysis as startAnalysisBody } from "@verikora/core";

import { storeForDocument, storesOf } from "@/app/active-store";
import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { startCheck } from "@/lib/checks";
import { deleteDocument, documentStorage, getDocument } from "@/lib/documents";
import { appEnvironment } from "@/lib/env";
import { handle, readJson } from "@/lib/http";
import { limit } from "@/lib/limits";
import { withFeatures } from "@/lib/settings/boundary";
import { insightFeatures } from "@/lib/settings/guards";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    const features = await insightFeatures(session.account.id);
    return Response.json({
      document: {
        ...withFeatures(await getDocument(session.account.id, id), features),
        ...(await documentStorage(session.account.id, id, (await storesOf(session.account.id)).describe)),
      },
    });
  });
}

/** Starts an Sovkora run on the document: `{ studio: "compliance-check", jurisdiction, asOf? }` or `{ studio: "document-authenticity", expectedIssuer? }`. */
export function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    await limit("analysis", req, session.account.id);
    const id = (await params).id;
    const request = await readJson(req, startAnalysisBody);
    const started = await startCheck(session.account, id, request, new Date(), appEnvironment());
    if (started.reused) return Response.json({ analysis: started.analysis, reused: true });
    const { analysis, via } = started;
    await audit({
      action: "analysis.started",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: id,
      detail: { studio: request.studio, runId: analysis.runId, via },
      headers: req.headers,
    });
    return Response.json({ analysis }, { status: 202 });
  });
}

export function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    await deleteDocument(session.account.id, id, await storeForDocument(session.account.id, id));
    await audit({
      action: "document.deleted",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: id,
      headers: req.headers,
    });
    return new Response(null, { status: 204 });
  });
}
