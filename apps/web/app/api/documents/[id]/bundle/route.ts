import { z } from "zod";

import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { handle, readJson } from "@/lib/http";
import { attachToLease, detachFromLease, DOCUMENT_ROLE, leaseBundle } from "@/lib/lease-bundle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const attach = z.object({ documentId: z.string(), role: z.enum([DOCUMENT_ROLE.annex, DOCUMENT_ROLE.buildingRules]) });
const detach = z.object({ documentId: z.string() });

/** A lease and its annexes read as one: per line, the document, the line, the quoted text, the rule, the article, and the ruleset's review status (verikora#129). */
export function GET(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    return Response.json({ bundle: await leaseBundle(session.account.id, (await params).id) });
  });
}

/** `{ documentId, role: "annex" | "building-rules" }`: attaches that document to this lease. */
export function POST(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    const body = await readJson(req, attach);
    await attachToLease(session.account.id, id, body.documentId, body.role);
    await audit({
      action: "document.attached",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: id,
      detail: { documentId: body.documentId, role: body.role },
      headers: req.headers,
    });
    return Response.json({ bundle: await leaseBundle(session.account.id, id) });
  });
}

/** `{ documentId }`: takes that annex out of this lease. */
export function DELETE(req: Request, { params }: Params) {
  return handle(async () => {
    const session = await requireSession(req);
    const id = (await params).id;
    const body = await readJson(req, detach);
    await detachFromLease(session.account.id, id, body.documentId);
    await audit({
      action: "document.detached",
      actorId: session.account.id,
      actorLabel: session.account.email,
      targetId: id,
      detail: { documentId: body.documentId },
      headers: req.headers,
    });
    return Response.json({ bundle: await leaseBundle(session.account.id, id) });
  });
}
