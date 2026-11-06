import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import {
  assertOpen,
  FILE_JURISDICTION,
  isRefusedField,
  LINK,
  linkState,
  MAX_DOCUMENTS_PER_FILE,
  NOT_NECESSARY_TYPES,
  requestedTypes,
  retentionOf,
  SEED_DOCUMENT_TYPES,
  SEED_FIELDS,
} from "./applicant-file-rules";
import { CONFIG_SEED } from "./config-seed";

/** verikora#127, the rules that need no database: the link's states, what a request may ask, the retention and the words. */
const NOW = new Date("2026-10-24T12:00:00Z");
const open = {
  status: "requested",
  expires_at: new Date("2026-11-07T12:00:00Z"),
  revoked_at: null,
  submitted_at: null,
  closed_at: null,
};
const BANNED =
  /certificat de conformit|\bconforme\b|authentiqu|\bfaux\b|certified|guarantee|\bgenuine\b|approuv|refus[ée]\b/i;
/** The error a function throws, for a status and a code to be read from it. */
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};
const SIN = /\bSIN\b|\bNAS\b|assurance sociale|social insurance/i;

describe("the link of an applicant file", () => {
  it("is open while it is valid, and refused for one reason each", () => {
    expect(linkState(open, NOW)).toBe(LINK.open);
    expect(linkState({ ...open, expires_at: NOW }, NOW)).toBe(LINK.expired);
    expect(linkState({ ...open, revoked_at: NOW }, NOW)).toBe(LINK.revoked);
    expect(linkState({ ...open, submitted_at: NOW }, NOW)).toBe(LINK.used);
    expect(linkState({ ...open, closed_at: NOW }, NOW)).toBe(LINK.closed);
    expect(linkState({ ...open, status: "erased" }, NOW)).toBe(LINK.erased);
  });

  it("a closed file is closed even when its link was also revoked", () => {
    expect(linkState({ ...open, closed_at: NOW, revoked_at: NOW }, NOW)).toBe(LINK.closed);
  });

  it("assertOpen refuses an upload on any other state, with its stable code", () => {
    expect(() => assertOpen(LINK.open)).not.toThrow();
    expect(thrown(() => assertOpen(LINK.expired))).toMatchObject({ status: 410 });
    expect(thrown(() => assertOpen(LINK.revoked))).toMatchObject({ status: 410 });
    expect(thrown(() => assertOpen(LINK.used))).toMatchObject({ status: 409 });
    try {
      assertOpen(LINK.expired);
    } catch (error) {
      expect((error as { body: { code: string } }).body.code).toBe("LINK_EXPIRED");
    }
  });
});

describe("what a request may ask for", () => {
  const catalogue = [...SEED_DOCUMENT_TYPES];

  it("asks for the known documents, once each", () => {
    expect(requestedTypes(["pay-stub", "pay-stub", "bank-statement"], catalogue)).toEqual([
      "pay-stub",
      "bank-statement",
    ]);
  });

  it("refuses an empty request, a document that is not necessary, and an unknown type", () => {
    expect(thrown(() => requestedTypes([], catalogue))).toMatchObject({ status: 400 });
    for (const forbidden of NOT_NECESSARY_TYPES) {
      expect(thrown(() => requestedTypes([forbidden], catalogue))).toMatchObject({ status: 422 });
    }
    expect(thrown(() => requestedTypes(["pay-stub", "sin"], catalogue))).toMatchObject({ status: 422 });
    expect(thrown(() => requestedTypes(["no-such"], catalogue))).toMatchObject({ status: 422 });
  });

  it("names no SIN, health, passport, licence or bank field, anywhere in the seed", () => {
    for (const fields of Object.values(SEED_FIELDS)) for (const f of fields) expect(isRefusedField(f)).toBe(false);
    expect(isRefusedField("sin")).toBe(true);
    expect(isRefusedField("health-card")).toBe(true);
    expect(JSON.stringify(SEED_FIELDS)).not.toMatch(SIN);
    expect(NOT_NECESSARY_TYPES).toEqual(
      expect.arrayContaining(["sin", "health-card", "passport", "driver-licence", "bank-details"]),
    );
  });

  it("checks against the Québec rules, with a bounded number of documents", () => {
    expect(FILE_JURISDICTION).toBe("QC");
    expect(MAX_DOCUMENTS_PER_FILE).toBeGreaterThanOrEqual(4);
  });
});

describe("retention", () => {
  it("a document is purged after its check by default", () => {
    expect(retentionOf("after-check", false)).toBe("after-check");
    expect(retentionOf("after-check", true)).toBe("after-check");
  });

  it("is kept until the decision only with the consent, and only for a type that allows it", () => {
    expect(retentionOf("after-decision", false)).toBe("after-check");
    expect(retentionOf("after-decision", true)).toBe("after-decision");
  });
});

describe("the catalogue and its words", () => {
  it("seeds the four document types from code (lib/config-seed.ts), and nothing that is refused", () => {
    const seed = CONFIG_SEED.filter((block) => block.includes("public.document_types")).join("\n");
    for (const id of SEED_DOCUMENT_TYPES) {
      expect(seed).toContain(`'${id}'`);
    }
    expect(seed).not.toMatch(/'sin'|'health-card'|'passport'|'bank-details'/);
  });

  it("gives every seeded type and field a label and a sentence, in French and in English", () => {
    for (const id of SEED_DOCUMENT_TYPES) {
      for (const d of [en, fr]) {
        expect(d.applicantFile.types[id].label.length).toBeGreaterThan(3);
        expect(d.applicantFile.types[id].what.length).toBeGreaterThan(15);
      }
    }
    for (const fields of Object.values(SEED_FIELDS)) {
      for (const f of fields) {
        expect(en.applicantFile.fields[f as keyof typeof en.applicantFile.fields]).toBeTruthy();
        expect(fr.applicantFile.fields[f as keyof typeof fr.applicantFile.fields]).toBeTruthy();
      }
    }
  });

  it("has every refusal code and every skipped check in both languages", () => {
    const codes = [
      "LINK_REVOKED",
      "LINK_EXPIRED",
      "LINK_USED",
      "FILE_CLOSED",
      "APPLICATION_ERASED",
      "TYPE_NOT_REQUESTED",
      "TOO_MANY_DOCUMENTS",
      "FILE_NOT_ACCEPTED",
      "DUPLICATE_DOCUMENT",
      "NO_DOCUMENT",
      "TYPE_NOT_NECESSARY",
      "TYPE_UNKNOWN",
      "STORAGE_UNAVAILABLE",
      "PURPOSE_NOT_IN_FILE",
      "CONSENT_REQUIRED",
      "NOT_FOUND",
    ];
    for (const d of [en, fr]) {
      for (const code of codes) expect(d.applicantFile.error[code as keyof typeof d.applicantFile.error]).toBeTruthy();
      for (const code of ["NO_TEXT", "PAYWALL", "UNAVAILABLE", "REFUSED"])
        expect(d.applicantFile.skipped[code as keyof typeof d.applicantFile.skipped]).toBeTruthy();
      for (const status of ["open", "revoked", "expired", "used", "closed", "erased"])
        expect(d.applicantFile.status[status as keyof typeof d.applicantFile.status]).toBeTruthy();
    }
  });

  it("says what the document check is, and that it is not a verdict, in both languages", () => {
    expect(JSON.stringify([en.applicantFile, fr.applicantFile])).not.toMatch(BANNED);
    expect(JSON.stringify([en.applicantFile, fr.applicantFile])).not.toMatch(SIN);
    expect(en.applicantFile.limits).toMatch(/decides nothing/);
    expect(fr.applicantFile.limits).toMatch(/ne décide rien/);
    expect(en.applicant.purpose.DOCUMENT_KEEP.label).toBeTruthy();
    expect(fr.applicant.purpose.DOCUMENT_KEEP.label).toBeTruthy();
    expect(JSON.stringify([en.applicant.purpose.DOCUMENT_KEEP, fr.applicant.purpose.DOCUMENT_KEEP])).not.toMatch(
      BANNED,
    );
  });
});
