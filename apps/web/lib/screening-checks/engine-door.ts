import {
  type CheckPurposeKey,
  type CheckResult as DoorResult,
  ORAZAKA_CODE,
  type OrazakaClient,
  OrazakaError,
} from "@krizaka/orazaka-client";

import { activeConsents } from "../applicant-consent";
import { logError } from "../log";
import {
  CHECK_OUTCOME,
  CHECK_PURPOSE,
  type CheckCall,
  type CheckPurpose,
  type CheckResult,
  type ChecksDoor,
  NOT_CONFIGURED,
} from "./model";

/*
 * The engine's door, opened (sovkora-engine#105): `POST /api/v1/checks/{purpose}` and `GET /api/v1/checks/{providerRef}`,
 * through the shared client `@krizaka/orazaka-client`. The answer is Sovkora's closed `CheckResult`, read 1:1 into this module's
 * vocabulary (`model.ts` is the same set). The compliance gate still wraps the door (`engineProvider`).
 */
type Door = Pick<OrazakaClient, "startCheck" | "collectCheck">;

/** Our purposes are the engine's, in the path's spelling. Identity is not one of them. */
const PATH: Record<CheckPurpose, CheckPurposeKey> = {
  [CHECK_PURPOSE.COURT_RECORDS]: "court-records",
  [CHECK_PURPOSE.CREDIT]: "credit",
};

const answered = (r: DoorResult): CheckResult => ({
  outcome: r.outcome,
  refusal: r.refusal,
  category: r.category,
  providerRef: r.providerRef,
});
const failed: CheckResult = {
  outcome: CHECK_OUTCOME.PROVIDER_ERROR,
  refusal: null,
  category: "NONE",
  providerRef: null,
};

/**
 * `consented` says whether the applicant's consent for a purpose stands now. Submitting is called after `consent()` recorded it
 * (so it is true by construction); collecting asks again, so a consent withdrawn since stops the poll's answer at Sovkora.
 */
export function engineDoor(
  client: Door,
  consented: (screeningId: string, purpose: CheckPurpose) => Promise<boolean>,
): ChecksDoor {
  return {
    async submit(purpose, call: CheckCall) {
      try {
        const { subject, region, runId } = call;
        return answered(
          await client.startCheck(PATH[purpose], {
            subject: { subjectId: subject.subjectId, firstName: subject.firstName, lastName: subject.lastName, region },
            consented: await consented(subject.subjectId, purpose),
            runId,
          }),
        );
      } catch (error) {
        // No key here is « not configured », like an engine with no provider; anything else is a provider error, never an invented result.
        if (error instanceof OrazakaError && error.code === ORAZAKA_CODE.notConfigured) return NOT_CONFIGURED;
        logError("screening: the engine's door failed on submit", error);
        return failed;
      }
    },
    async collect(purpose, call, providerRef) {
      try {
        return answered(
          await client.collectCheck(providerRef, {
            subjectId: call.subject.subjectId,
            consented: await consented(call.subject.subjectId, purpose),
          }),
        );
      } catch (error) {
        // A failed poll is not an answer: the check stays pending and is asked again.
        if (error instanceof OrazakaError && error.code === ORAZAKA_CODE.notConfigured) return NOT_CONFIGURED;
        logError("screening: the engine's door failed on collect", error);
        return { outcome: CHECK_OUTCOME.PENDING, refusal: null, category: "NONE", providerRef };
      }
    },
  };
}

export const standingConsent = async (screeningId: string, purpose: CheckPurpose): Promise<boolean> =>
  (await activeConsents(screeningId)).includes(purpose);
