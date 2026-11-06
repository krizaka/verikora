import { describe, expect, it } from "vitest";

import { CONSENT_PURPOSE } from "./applicant-consent";
import { LINK, type LinkState } from "./applicant-file-rules";
import { applicantPageOf, loadApplicantPage } from "./applicant-page";
import { HttpError } from "./http";

const state = (
  over: Partial<{
    status: LinkState;
    types: string[];
    documents: { id: string; typeId: string | null; filename: string; sizeBytes: number }[];
  }> = {},
) => ({
  status: over.status ?? LINK.open,
  expiresAt: "2026-11-07T15:00:00.000Z",
  types: (over.types ?? ["pay-stub", "bank-statement"]).map((id) => ({
    id,
    fields: [],
    retentionPolicy: "after-check",
  })),
  documents: (over.documents ?? []).map((d) => ({ signals: [], ...d })),
});
const checked = [CONSENT_PURPOSE.DOCUMENT_CHECK];

describe("the applicant's page (verikora#341)", () => {
  it("shows the types of the request, in its order, each with the documents already received of that type", () => {
    const page = applicantPageOf(
      state({ documents: [{ id: "d1", typeId: "bank-statement", filename: "releve.pdf", sizeBytes: 1200 }] }),
      checked,
    );
    expect(page.rows.map((r) => r.typeId)).toEqual(["pay-stub", "bank-statement"]);
    expect(page.rows[0]!.documents).toEqual([]);
    expect(page.rows[1]!.documents.map((d) => d.filename)).toEqual(["releve.pdf"]);
  });

  it("offers no upload before the consent to the check — nor with only the consent to keep", () => {
    expect(applicantPageOf(state(), []).canUpload).toBe(false);
    expect(applicantPageOf(state(), [CONSENT_PURPOSE.DOCUMENT_KEEP]).canUpload).toBe(false);
    expect(applicantPageOf(state(), checked).canUpload).toBe(true);
  });

  it("withdrawing the consent closes the drop again", () => {
    expect(applicantPageOf(state(), checked).canUpload).toBe(true);
    expect(applicantPageOf(state(), []).canUpload).toBe(false);
  });

  it("submits only with at least one document, and only on an open link", () => {
    expect(applicantPageOf(state(), checked).canSubmit).toBe(false);
    const sent = [{ id: "d1", typeId: "pay-stub", filename: "a.pdf", sizeBytes: 1 }];
    expect(applicantPageOf(state({ documents: sent }), checked).canSubmit).toBe(true);
    expect(applicantPageOf(state({ documents: sent, status: LINK.used }), checked).canSubmit).toBe(false);
  });

  it.each([
    [LINK.revoked, "LINK_REVOKED"],
    [LINK.expired, "LINK_EXPIRED"],
    [LINK.closed, "FILE_CLOSED"],
    [LINK.erased, "APPLICATION_ERASED"],
    [LINK.used, "LINK_USED"],
  ] as const)("a %s link says so, and offers no upload or submission", (status, code) => {
    const page = applicantPageOf(state({ status }), checked);
    expect(page.open).toBe(false);
    expect(page.closedBecause).toBe(code);
    expect(page.canUpload).toBe(false);
    expect(page.canSubmit).toBe(false);
  });

  it("an open link has no banner; withdrawing and erasing stay available unless the file is erased", () => {
    const open = applicantPageOf(state(), checked);
    expect(open.closedBecause).toBeNull();
    expect(open.canWithdraw).toBe(true);
    expect(applicantPageOf(state({ status: LINK.expired }), checked).canWithdraw).toBe(true);
    expect(applicantPageOf(state({ status: LINK.erased }), checked).canWithdraw).toBe(false);
  });

  it("loads a file token's page, and nothing for a token that is not a file (a screening's) or unknown", async () => {
    const row = { id: "app-1" };
    const deps = {
      fileByToken: async (token: string) => {
        if (token !== "file-token") {
          throw new HttpError(404, "No such link");
        }
        return row;
      },
      applicantFileState: async () => state(),
      activeConsents: async () => checked,
    };
    const now = new Date("2026-10-25T12:00:00Z");
    const page = await loadApplicantPage("file-token", now, deps);
    expect(page?.state.types).toHaveLength(2);
    expect(page?.consents).toEqual(checked);
    expect(await loadApplicantPage("a-screening-token", now, deps)).toBeNull();
  });

  it("lets any other failure through", async () => {
    const deps = {
      fileByToken: async () => Promise.reject(new Error("db down")),
      applicantFileState: async () => state(),
      activeConsents: async () => [],
    };
    await expect(loadApplicantPage("t", new Date(), deps)).rejects.toThrow("db down");
  });

  it("takes an explanation of a trace while the link stands or was used, with the consent to the check, and not otherwise (verikora#626)", () => {
    expect(applicantPageOf(state(), checked).canAnswer).toBe(true);
    expect(applicantPageOf(state({ status: LINK.used }), checked).canAnswer).toBe(true);
    expect(applicantPageOf(state(), []).canAnswer).toBe(false);
    for (const status of [LINK.revoked, LINK.expired, LINK.closed, LINK.erased]) {
      expect(applicantPageOf(state({ status }), checked).canAnswer).toBe(false);
    }
  });
});
