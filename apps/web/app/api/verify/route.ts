import { requireSession } from "@/lib/access";
import { audit } from "@/lib/audit";
import { handle, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { verifyReport } from "@/lib/report";
import { accessTo, loadTarget, referenceOf } from "@/lib/report-access";
import { attestationOfPdf, verifyPdf } from "@/lib/report-pdf";
import { signingKey } from "@/lib/report-signer";
import { MAX_BODY_BYTES, readVerifyForm } from "@/lib/verify";
import { kindOfSchema, pdfSchemaId, verifyOwnerPdfView } from "@/lib/verify-dispatch";
import { PRODUCT_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** True for an owner-report PDF; refuses a schema Yomizaka does not verify; false for a compliance PDF or a file with no attestation. */
async function ownerKindOrRefuse(pdf: Uint8Array | null) {
  if (!pdf) return false;
  const kind = kindOfSchema(await pdfSchemaId(pdf));
  if (kind === "unknown") throw refuse(422, "UNKNOWN_SCHEMA", `This report uses a format ${PRODUCT_NAME} does not verify`);
  return kind === "owner";
}

async function verifyOwner(input: Uint8Array | null, who: { id: string; email: string }, req: Request) {
  const pdf = input && (await ownerKindOrRefuse(input)) ? input : null;
  if (!pdf) return null;
  const result = await verifyOwnerPdfView(pdf, signingKey());
  await audit({
    action: "report.verified",
    actorId: who.id,
    actorLabel: who.email,
    targetId: null,
    detail: {
      runId: null,
      schema: "owner-report",
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
      via: "none",
      fileSha256: result.fileSha256,
    },
    headers: req.headers,
  });
  return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Checks a Yomizaka audit report (multipart: `report` file or `reportText`, optionally the original `document`).
 * Members only, and only for a report the caller owns or was granted (ADR-0002):
 *   no session → 401 · a report without a grant (or one this server does not hold) → 403 NO_ACCESS · a grant → 200.
 * Every verification, and every refusal, is written to the audit log: who checked what, and when.
 * Nothing is kept — files are read in memory, checked and dropped — and nothing is analysed by a model.
 */
export function POST(req: Request) {
  return handle(async () => {
    const session = await requireSession(req);
    const who = { id: session.account.id, email: session.account.email };
    await limit("verify", req, who.id);
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES)
      throw refuse(413, "FILE_TOO_LARGE", "Too large");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw refuse(400, "BAD_REQUEST", "Expected a multipart form");
    }
    const { text, pdf, document } = await readVerifyForm(form);
    // The payload's schema id picks the verifier. An owner report holds no analysis to look up: it is checked by its signature only.
    const ownerAnswer = await verifyOwner(pdf, who, req);
    if (ownerAnswer) return ownerAnswer;
    // A PDF carries its attestation in its Info dictionary; an HTML report in its script block.
    const embedded = pdf ? await attestationOfPdf(pdf) : null;
    const embeddedReference = embedded
      ? { runId: embedded.payload.check.runId, documentSha256: embedded.payload.document.sha256 }
      : null;
    const reference = pdf ? embeddedReference : referenceOf(text);
    // A file that is not a report holds nothing to protect: it fails like before (NOT_A_REPORT / UNREADABLE).
    const target = reference ? await loadTarget(reference.runId, reference.documentSha256) : null;
    const access = target ? accessTo(target, who, new Date()) : ({ allowed: false } as const);
    if (reference && !access.allowed) {
      await audit({
        action: "report.verify_denied",
        actorId: who.id,
        actorLabel: who.email,
        targetId: target?.analysisId ?? null,
        detail: { runId: reference.runId, known: target !== null },
        headers: req.headers,
      });
      throw refuse(403, "NO_ACCESS", "You do not have access to this report", {
        requestable: true,
        runId: reference.runId,
        documentSha256: reference.documentSha256,
      });
    }
    const result = pdf ? await verifyPdf(pdf, signingKey(), document) : verifyReport(text, signingKey(), document);
    await audit({
      action: "report.verified",
      actorId: who.id,
      actorLabel: who.email,
      targetId: target?.analysisId ?? null,
      detail: {
        runId: reference?.runId ?? null,
        ok: result.ok,
        ...(result.ok ? {} : { reason: result.reason }),
        via: access.allowed ? access.via : "none",
        ...(access.allowed && access.via === "grant" ? { grantId: access.grantId } : {}),
        fileSha256: result.fileSha256,
      },
      headers: req.headers,
    });
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  });
}
