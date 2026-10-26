import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import {
  assertAnalysisAllowed,
  assertUploadForApplication,
  CONSENT_PURPOSE,
  CONSENT_PURPOSES,
  eraseApplication,
  grantConsent,
  hasConsent,
  NOTICE_VERSION,
  purposesOfTypes,
  requireConsent,
  withdrawConsent,
} from "./applicant-consent";
import { migrate, query } from "./db";
import { byToken, requestScreening } from "./screening";

/** yomizaka#131: the applicant's notice, the consent per purpose and the gates. The database cases run with YOMIZAKA_DB_IT=1. */
const NOTICE_KEYS = ["collected", "why", "who", "howLong", "ask"] as const;
const BANNED = /certificat de conformit|\bconforme\b|authentiqu|\bfaux\b|certified|guarantee|\bgenuine\b/i;

describe("the purposes are the engine's names (orazaka-ai-engine CheckPurpose) plus the document check", () => {
  it("names them as the engine does, so ExternalCheckService reads the same record", () => {
    expect([...CONSENT_PURPOSES].sort()).toEqual(["COURT_RECORDS", "CREDIT", "DOCUMENT_CHECK", "DOCUMENT_KEEP"]);
    expect(CONSENT_PURPOSE.COURT_RECORDS).toBe("COURT_RECORDS");
    expect(CONSENT_PURPOSE.CREDIT).toBe("CREDIT");
  });
  it("maps the screening scope to the Québec history purpose, and nothing else", () => {
    expect(purposesOfTypes([{ purpose: "COURT_RECORDS" }])).toEqual(["COURT_RECORDS"]);
    expect(purposesOfTypes([{ purpose: "COURT_RECORDS" }, { purpose: "COURT_RECORDS" }, { purpose: "CREDIT" }])).toEqual(["COURT_RECORDS", "CREDIT"]);
    expect(purposesOfTypes([{ purpose: "IDENTITY" }])).toEqual([]);
  });
  it("hasConsent answers only for an active purpose", () => {
    expect(hasConsent(["COURT_RECORDS"], CONSENT_PURPOSE.COURT_RECORDS)).toBe(true);
    expect(hasConsent([], CONSENT_PURPOSE.DOCUMENT_CHECK)).toBe(false);
  });
  it("carries a dated notice version", () => {
    expect(NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("the notice says plainly what is collected, why, who sees it, how long, and how to ask for deletion (FR and EN)", () => {
  it("has every item in both languages, with the retention placeholder", () => {
    for (const d of [en, fr]) {
      for (const k of NOTICE_KEYS) expect(d.applicant.notice[k].length).toBeGreaterThan(30);
      expect(d.applicant.notice.howLong).toContain("{days}");
    }
  });
  it("gives each purpose a label and what it does, in both languages", () => {
    for (const d of [en, fr]) {
      for (const p of CONSENT_PURPOSES) {
        expect(d.applicant.purpose[p].label.length).toBeGreaterThan(5);
        expect(d.applicant.purpose[p].what.length).toBeGreaterThan(20);
      }
    }
  });
  it("never uses a guarantee or a verdict word: the report is informative and a person decides", () => {
    expect(JSON.stringify([en.applicant, fr.applicant])).not.toMatch(BANNED);
    expect(en.applicant.notice.why).toMatch(/informative/i);
    expect(fr.applicant.notice.why).toMatch(/informatif/i);
  });
  it("states that no social insurance number is asked, in both languages", () => {
    expect(en.applicant.notice.notAsked).toMatch(/social insurance number/i);
    expect(fr.applicant.notice.notAsked).toMatch(/assurance sociale/i);
  });
});

describe("no SIN is ever asked by the code either", () => {
  it("the consent service and the applicant route carry no SIN or NAS field", () => {
    for (const file of ["applicant-consent.ts", "../app/api/applicant/route.ts"]) {
      const code = readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\b(sin|nas|socialInsurance|social_insurance)\b/i);
    }
  });
});

describe.runIf(process.env.YOMIZAKA_DB_IT === "1" && !!process.env.DATABASE_URL)("consent gates (database)", () => {
  const NOW = new Date("2026-10-24T12:00:00Z");
  const stamp = Date.now();
  let landlord: { id: string; email: string };
  let app: string;
  let token: string;

  it("sets up an application for a landlord", async () => {
    await migrate();
    [landlord] = (await query<{ id: string; email: string }>("INSERT INTO accounts (email) VALUES ($1) RETURNING id, email", [`consent-landlord-${stamp}@yomizaka.test`])) as [typeof landlord];
    const made = await requestScreening(landlord, { tenantName: "Camille Fictif", tenantEmail: `c-${stamp}@exemple.test`, scope: ["payment-history"] }, NOW);
    app = made.id;
    token = made.token;
    expect(app).toBeTruthy();
    expect(token).toBeTruthy();
  });

  it("refuses an upload for the application without the document-check consent, and an analysis too", async () => {
    await expect(assertUploadForApplication(landlord.id, app)).rejects.toMatchObject({ status: 403, body: { code: "CONSENT_REQUIRED" } });
    await expect(assertAnalysisAllowed(app)).rejects.toMatchObject({ status: 403, body: { code: "CONSENT_REQUIRED" } });
  });

  it("refuses a consent given to an old notice version", async () => {
    await expect(grantConsent(app, CONSENT_PURPOSE.DOCUMENT_CHECK, { noticeVersion: "1999-01-01.1", means: "web-form" }, NOW)).rejects.toMatchObject({ status: 409, body: { code: "NOTICE_CHANGED" } });
  });

  it("records a consent per purpose once; a repeat changes nothing", async () => {
    expect(await grantConsent(app, CONSENT_PURPOSE.DOCUMENT_CHECK, { noticeVersion: NOTICE_VERSION, means: "web-form" }, NOW)).toBe(true);
    expect(await grantConsent(app, CONSENT_PURPOSE.DOCUMENT_CHECK, { noticeVersion: NOTICE_VERSION, means: "web-form" }, NOW)).toBe(false);
    await expect(requireConsent(app, CONSENT_PURPOSE.DOCUMENT_CHECK)).resolves.toBeUndefined();
    await expect(requireConsent(app, CONSENT_PURPOSE.CREDIT)).rejects.toMatchObject({ body: { code: "CONSENT_REQUIRED" } });
    await expect(assertUploadForApplication(landlord.id, app)).resolves.toBeUndefined();
  });

  it("refuses an upload from another landlord as if the application did not exist", async () => {
    await expect(assertUploadForApplication("00000000-0000-4000-8000-000000000000", app)).rejects.toMatchObject({ status: 404 });
  });

  it("a withdrawal stops the analysis and the upload for that application", async () => {
    expect(await withdrawConsent(app, CONSENT_PURPOSE.DOCUMENT_CHECK, NOW)).toBe(true);
    await expect(assertAnalysisAllowed(app)).rejects.toMatchObject({ body: { code: "CONSENT_REQUIRED" } });
    await expect(assertUploadForApplication(landlord.id, app)).rejects.toMatchObject({ body: { code: "CONSENT_REQUIRED" } });
  });

  it("a withdrawal of the court-records purpose declines the pending request, so no check runs", async () => {
    await grantConsent(app, CONSENT_PURPOSE.COURT_RECORDS, { noticeVersion: NOTICE_VERSION, means: "web-form" }, NOW);
    await withdrawConsent(app, CONSENT_PURPOSE.COURT_RECORDS, NOW);
    expect((await byToken(token)).status).toBe("declined");
  });

  it("erasure blanks the personal fields and audits without the e-mail", async () => {
    await eraseApplication(app, landlord.id, undefined, NOW);
    const row = await byToken(token);
    expect(row).toMatchObject({ status: "erased", tenant_name: "" });
    expect(row.tenant_email).toMatch(/@erased\.invalid$/);
    const trail = await query<{ detail: unknown; actor_label: string }>("SELECT actor_label, detail FROM audit_log WHERE target_id = $1 AND action = 'applicant.erased'", [app]);
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail)).not.toContain("@exemple.test");
  });
});
