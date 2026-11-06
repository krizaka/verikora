import { authenticityReport, complianceReport, isSeededCheck, SEEDED_INPUTS } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { generateDocument, PERSONA_ERIC } from "../../../scripts/demo-documents/index.mjs";
import { CAST_MEMBER } from "../../../scripts/demo-seed/cast.mjs";
import {
  assertNotProduction,
  collectionWords,
  PERSONAS,
  SEEDED_INPUTS as SEED_MARKER,
  seededReport,
  seedPersona,
  stampBefore,
} from "../../../scripts/demo-seed/seed.mjs";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

describe("the demo seed", () => {
  it("refuses production, and anything that is not dev", () => {
    expect(() =>
      assertNotProduction({
        APP_ENVIRONMENT: "prod",
        APP_DEMO_ACCOUNT_EMAIL: "demo@example.test",
        APP_DEMO_ACCOUNT_PASSWORD: "long-enough-password",
      }),
    ).toThrow(/refused/);
    expect(() => assertNotProduction({ APP_ENVIRONMENT: "staging" })).toThrow(/refused/);
  });

  it("works on dev and on a local machine (the default environment is dev)", () => {
    expect(() => assertNotProduction({ APP_ENVIRONMENT: "dev" })).not.toThrow();
    expect(() => assertNotProduction({})).not.toThrow();
  });

  it("marks its checks with the marker the app reads: shown like any check, never certified", () => {
    expect(SEED_MARKER).toEqual(SEEDED_INPUTS);
    expect(isSeededCheck({ inputs: { ...SEED_MARKER } })).toBe(true);
  });

  it("gives the persona a display name the header can show instead of the address (A4), within the column's limit", () => {
    expect(PERSONAS.eric.name).toBe(CAST_MEMBER.displayName);
    expect(PERSONAS.eric.name.length).toBeLessThanOrEqual(80);
  });

  it("names the three collections in French and in English, through the messages", () => {
    for (const messages of [fr, en]) {
      for (const c of PERSONA_ERIC.collections as { key: string }[]) {
        const words = collectionWords(messages, "eric", c.key);
        expect(words.name.length).toBeGreaterThan(0);
        expect(words.description?.length ?? 0).toBeLessThanOrEqual(500);
      }
    }
    expect(collectionWords(fr, "eric", "rosemont").name).toBe("Immeuble Rosemont");
    expect(collectionWords(fr, "eric", "villeray").name).toBe("Candidats — 4½ Villeray");
    expect(collectionWords(fr, "eric", "invoices").name).toBe("Factures 2026");
    expect(() => collectionWords(fr, "eric", "nope")).toThrow();
  });

  it("seeds checks the app reads like Sovkora's, each flawed document with its blocking finding", async () => {
    for (const id of PERSONA_ERIC.checked as string[]) {
      const doc = await generateDocument(id);
      const report = seededReport(doc);
      const parsed = doc.family === "lease" ? complianceReport.safeParse(report) : authenticityReport.safeParse(report);
      expect(parsed.success, id).toBe(true);
      const flagged =
        "findings" in report
          ? report.findings?.some((f: { verdict: string }) => f.verdict === "FAIL")
          : report.signals?.some((s: { level: string }) => s.level === "incohérent");
      expect(flagged, id).toBe(doc.flaw !== null);
    }
  });

  it("stamps every document and report from the injected clock, one minute apart, never from the database's own clock (#641)", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const stamps: { sql: string; values: unknown[] }[] = [];
    const q = async (sql: string, values: unknown[] = []) => {
      stamps.push({ sql, values });
      if (/INSERT INTO accounts/.test(sql)) {
        return [{ id: "owner", locale: "fr", name: "Éric" }];
      }
      if (/FROM libraries/.test(sql)) {
        return [{ id: "library" }];
      }
      if (/INSERT INTO collections/.test(sql)) {
        return [{ id: "collection" }];
      }
      if (/INSERT INTO documents/.test(sql)) {
        return [{ id: values[0] }];
      }
      if (/SELECT id FROM documents/.test(sql)) {
        return [{ id: "stored" }];
      }
      if (/count\(\*\)/.test(sql)) {
        return [{ n: 0 }];
      }
      if (/INSERT INTO screenings/.test(sql)) {
        return [{ id: "file" }];
      }
      return [];
    };
    await seedPersona(q, { persona: "eric", email: "eric@demo.verikora.test", messagesByLocale: { fr, en }, now });
    const docs = stamps.filter((s) => /INSERT INTO documents/.test(s.sql)).map((s) => s.values[11] as string);
    const checks = stamps.filter((s) => /INSERT INTO analyses/.test(s.sql));
    expect(docs.length).toBeGreaterThan(1);
    expect(new Set(docs).size).toBe(docs.length);
    expect(docs.every((d) => Date.parse(d) <= now.getTime() && Date.parse(d) > now.getTime() - 3_600_000)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.sql).not.toMatch(/now\(\)/i);
      expect(Date.parse(c.values.at(-1) as string)).toBeLessThanOrEqual(now.getTime());
    }
    expect(stampBefore(now, 3)).toBe("2026-10-30T11:57:00.000Z");
  });
});
