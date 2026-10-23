import { KrizakaQueryProvider } from "@krizaka/query";
import { SEEDED_INPUTS } from "@yomizaka/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { DocumentView } from "./DocumentView";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/fr/app/documents/d1/verifications", useSearchParams: () => new URLSearchParams(nav.search) }));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");

/** A finished compliance check, as Orazaka returns it — or as the demo seed wrote it (`inputs.seeded`). */
const check = (inputs: Record<string, string>) => ({
  id: "a1",
  studio: "compliance-check",
  status: "succeeded",
  runId: inputs.seeded ? "seeded-bail-rosemont-5-clause-illegale" : "run_8f3a2c",
  blueprintVersion: inputs.seeded ? null : "1.4.0",
  inputs,
  report: {
    rulesetId: "qc-residential-lease",
    rulesetVersion: "2026-06-20",
    jurisdiction: "QC",
    asOf: "2026-10-23",
    summary: { byVerdict: { FAIL: 1 }, blockingFailures: 1, rulesEvaluated: 1 },
    findings: [{ ruleId: "QC-LEASE-004", title: "Dépôt de garantie interdit", severity: "BLOCKING", verdict: "FAIL", explanation: "Le bail exige un dépôt.", evidenceSpan: { quote: "dépôt de sécurité de 1 450 $" }, method: "DETERMINISTIC" }],
  },
  error: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:04.000Z",
});
const document = (inputs: Record<string, string>) => ({
  id: "d1",
  title: "Bail — Rosemont, logement 5",
  filename: "bail-rosemont-5.pdf",
  mimeType: "application/pdf",
  kind: "lease",
  sizeBytes: 3000,
  pages: 1,
  hasText: true,
  status: "attention",
  createdAt: "2026-10-23T11:59:00.000Z",
  sha256: "a".repeat(64),
  text: "BAIL DE LOGEMENT … dépôt de sécurité de 1 450 $ …",
  analyses: [check(inputs)],
  storage: { kind: "database", endpoint: null, region: "ca", residency: "canada", encrypted: true, owner: "krizaka", devOnly: false },
  retainUntil: null,
  purged: false,
});
const render = (inputs: Record<string, string>, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <DocumentView initial={document(inputs) as never} tab="verifications" perspective="landlord" offer={{ studios: ["compliance-check", "document-authenticity"], jurisdictions: ["QC"], rulesets: [] }} />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("a document's checks tab with a seeded demo check (krizaka/yomizaka#274)", () => {
  it("renders the findings and says the check is a demo one, with no signed report offered — the page never breaks on the 409", () => {
    const html = render({ ...SEEDED_INPUTS });
    const text = readable(html);
    expect(text).toContain("Dépôt de garantie interdit");
    expect(text).toContain("seeded-bail-rosemont-5-clause-illegale");
    expect(html).toContain('data-testid="seeded-note"');
    expect(text).toContain(fr.console.analysis.seededNote);
    expect(html).not.toContain('data-testid="report-download"');
    expect(readable(render({ ...SEEDED_INPUTS }, "en"))).toContain(en.console.analysis.seededNote);
  });

  it("offers the signed report for a real finished check", () => {
    const html = render({ jurisdiction: "QC", asOf: "2026-10-23" });
    expect(html).toContain('data-testid="report-download"');
    expect(html).not.toContain('data-testid="seeded-note"');
  });
});

describe("a check the task page could not start on the drop (the review's Y4)", () => {
  it("says the engine's refusal above the form when it arrives in the address, and nothing otherwise", () => {
    nav.search = "refused=RATE_LIMITED";
    const html = render({ jurisdiction: "QC" });
    expect(readable(html)).toContain(fr.console.errors.RATE_LIMITED ?? fr.console.errors.UNKNOWN);
    nav.search = "";
    expect(readable(render({ jurisdiction: "QC" }))).not.toContain(fr.console.errors.UNKNOWN);
  });
});
