import { z } from "zod";

import { storesOf } from "@/app/active-store";
import {
  activeConsents,
  APPLICATION_ERASED,
  CONSENT_MEANS,
  CONSENT_PURPOSE,
  type ConsentPurpose,
  eraseApplication,
  grantConsent,
  NOTICE_VERSION,
  withdrawConsent,
} from "@/lib/applicant-consent";
import { applicantFileState, submitApplicantFile } from "@/lib/applicant-file";
import { assertOpen, linkState } from "@/lib/applicant-file-rules";
import { handle, readJson, refuse } from "@/lib/http";
import { limit } from "@/lib/limits";
import { byToken } from "@/lib/screening";
import { ANSWER_MAX, answerSignal } from "@/lib/signal-answers";

export const dynamic = "force-dynamic";

const token = z.string().min(20).max(80);
const purpose = z.enum([
  CONSENT_PURPOSE.DOCUMENT_CHECK,
  CONSENT_PURPOSE.COURT_RECORDS,
  CONSENT_PURPOSE.CREDIT,
  CONSENT_PURPOSE.DOCUMENT_KEEP,
]);
/** The purposes an applicant file asks for: the documents' check and their keeping. The other purposes belong to a screening. */
const FILE_PURPOSES: ReadonlySet<ConsentPurpose> = new Set([
  CONSENT_PURPOSE.DOCUMENT_CHECK,
  CONSENT_PURPOSE.DOCUMENT_KEEP,
]);
const body = z.discriminatedUnion("action", [
  z.object({ token, action: z.literal("view") }),
  z.object({ token, action: z.literal("grant"), purpose, noticeVersion: z.string().min(1).max(40) }),
  z.object({ token, action: z.literal("withdraw"), purpose }),
  z.object({ token, action: z.literal("erase") }),
  z.object({ token, action: z.literal("submit") }),
  // ADR-0014 (verikora#626): the applicant's explanation of a trace found in one of their documents; an empty text removes it.
  z.object({
    token,
    action: z.literal("answer"),
    documentId: z.string().min(1).max(64),
    signalId: z.string().min(1).max(64),
    text: z.string().max(ANSWER_MAX * 4),
  }),
]);

/**
 * The applicant's side of verikora#131 and #127, reached by the link the manager handed over (the same token as a screening):
 * read the notice and the file's state, consent or withdraw per purpose, send the file, or ask for the deletion of the
 * documents and result. No account is needed; rate-limited by address; every change is audit-logged without personal data.
 * A consent to upload or keep, and the submission, need an open link; a withdrawal and an erasure are always allowed.
 */
export function POST(req: Request) {
  return handle(async () => {
    await limit("applicant", req, null);
    const input = await readJson(req, body);
    const now = new Date();
    const app = await byToken(input.token);
    if (app.status === APPLICATION_ERASED) {
      throw refuse(410, "APPLICATION_ERASED", "This application was erased");
    }
    const file = app.flow === "file";
    if (file && input.action === "grant") {
      if (!FILE_PURPOSES.has(input.purpose)) {
        throw refuse(422, "PURPOSE_NOT_IN_FILE", "This purpose does not belong to an applicant file", {
          purpose: input.purpose,
        });
      }
      assertOpen(linkState(app, now));
    }
    if (file && input.action === "submit") {
      assertOpen(linkState(app, now));
    }
    if (file && input.action === "answer") {
      await answerSignal(app, input, now, req.headers);
    }
    if (input.action === "grant") {
      await grantConsent(
        app.id,
        input.purpose,
        { noticeVersion: input.noticeVersion, means: CONSENT_MEANS.WEB_FORM },
        now,
        req.headers,
      );
    }
    if (input.action === "withdraw") {
      await withdrawConsent(app.id, input.purpose, now, req.headers);
    }
    if (input.action === "submit") {
      await submitApplicantFile(input.token, now, req.headers);
      return Response.json({ submitted: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (input.action === "erase") {
      await eraseApplication(app.id, app.landlord_id, (await storesOf(app.landlord_id)).write, now, req.headers);
      return Response.json({ erased: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const active = await activeConsents(app.id);
    const purposes = Object.values(CONSENT_PURPOSE) as ConsentPurpose[];
    const fileState = file ? await applicantFileState(input.token, now) : undefined;
    return Response.json(
      {
        noticeVersion: NOTICE_VERSION,
        purposes: purposes.map((p) => ({ purpose: p, granted: active.includes(p) })),
        ...(fileState ? { file: fileState } : {}),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
