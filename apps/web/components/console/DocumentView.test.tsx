import { KrizakaQueryProvider } from "@krizaka/query";
import { SEEDED_INPUTS } from "@verikora/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import type { RegistryReport } from "@/lib/registries/report";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { DocumentView } from "./DocumentView";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/fr/app/documents/d1/rapport",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");

/** A finished compliance check, as Sovkora returns it — or as the demo seed wrote it (`inputs.seeded`). */
const check = (inputs: Record<string, string>, id = "a1", runId = "run_8f3a2c") => ({
  id,
  studio: "compliance-check",
  status: "succeeded",
  runId: inputs.seeded ? "seeded-bail-rosemont-5-clause-illegale" : runId,
  blueprintVersion: inputs.seeded ? null : "1.4.0",
  inputs,
  report: {
    rulesetId: "qc-residential-lease",
    rulesetVersion: "2026-06-20",
    jurisdiction: "QC",
    asOf: "2026-10-23",
    summary: { byVerdict: { FAIL: 1, PASS: 1 }, blockingFailures: 1, rulesEvaluated: 2 },
    findings: [
      {
        ruleId: "QC-LEASE-001",
        title: "Durée du bail",
        severity: "INFO",
        verdict: "PASS",
        explanation: "Douze mois.",
        method: "DETERMINISTIC",
      },
      {
        ruleId: "QC-LEASE-004",
        title: "Dépôt de garantie interdit",
        severity: "BLOCKING",
        verdict: "FAIL",
        explanation: "Le bail exige un dépôt.",
        evidenceSpan: { quote: "dépôt de sécurité de 1 450 $" },
        method: "DETERMINISTIC",
        citation: "C.c.Q., art. 1904",
      },
    ],
  },
  error: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  finishedAt: "2026-10-23T12:00:04.000Z",
});
const insight = {
  understanding: {
    nature: { id: "lease", label: { fr: "Bail de logement", en: "Residential lease" }, confidence: "high", score: 0.9 },
    alternative: null,
    language: "fr",
    pages: 1,
    issuer: null,
    dates: [],
    parties: [
      { role: "landlord", name: "Mathis Imaginaire-Roy" },
      { role: "tenant", name: "Camille Fictif-Beaulieu" },
    ],
    references: [],
    amounts: [
      { kind: "rent", cents: 145000, text: "1 450,00 $" },
      { kind: "rent", cents: 145000, text: "1 450,00 $" },
    ],
    check: { studio: "compliance-check", documentType: "lease", ruleset: null },
    authenticity: true,
    needsModel: false,
  },
  pii: { total: 0, counts: {} },
};
const document = (analyses: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "d1",
  title: "bail-rosemont-5",
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
  analyses,
  storage: {
    kind: "database",
    endpoint: null,
    region: "ca",
    residency: "canada",
    encrypted: true,
    owner: "krizaka",
    devOnly: false,
  },
  retainUntil: null,
  purged: false,
  insight,
  ...extra,
});
const render = (
  doc: ReturnType<typeof document>,
  tab: "rapport" | "document" | "historique" = "rapport",
  locale: "en" | "fr" = "fr",
  place: { libraryId: string; collectionId: string; name: string; isDefault: boolean } | null = null,
  registry: RegistryReport | null = null,
) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <DocumentView
          initial={doc as never}
          tab={tab}
          place={place}
          registry={registry}
          perspective="landlord"
          offer={{ studios: ["compliance-check", "document-authenticity"], jurisdictions: ["QC"], rulesets: [] }}
        />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("the document on DetailLayout (the UX review's Y5)", () => {
  it("names the document by what the insight knows — never the filename as the title — with one h1, its status, and the filename as the eyebrow", () => {
    nav.search = "";
    const html = render(document([check({ jurisdiction: "QC" })]));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const text = readable(html);
    expect(text).toContain("Bail de logement — Camille Fictif-Beaulieu");
    expect(html).not.toMatch(/<h1[^>]*>[^<]*bail-rosemont-5/);
    expect(text).toContain("bail-rosemont-5.pdf");
    expect(text).toContain("À regarder");
  });

  it("the report tab says the verdict first, the findings with what failed first, the engine's facts folded — the run id once on the face", () => {
    const html = render(document([check({ jurisdiction: "QC" })]));
    const band = html.indexOf('data-testid="verdict-band"');
    const findings = html.indexOf('data-testid="finding-list"');
    const technical = html.indexOf('data-testid="technical-details"');
    expect(band).toBeGreaterThan(0);
    expect(findings).toBeGreaterThan(band);
    expect(technical).toBeGreaterThan(findings);
    const text = readable(html);
    expect(text).toContain("1 règle sur 2 demande votre attention");
    expect(text.indexOf("Dépôt de garantie interdit")).toBeLessThan(text.indexOf("Durée du bail"));
    expect(html.match(/run_8f3a2c/g)).toHaveLength(1);
    expect(html.indexOf("run_8f3a2c")).toBeGreaterThan(technical);
    expect(text).not.toContain("BLOCKING");
  });

  it("leads back to the document's collection (its name), or to the library when it has none", () => {
    const placed = render(document([check({ jurisdiction: "QC" })]), "rapport", "fr", {
      libraryId: "l1",
      collectionId: "c1",
      name: "4½ Villeray",
      isDefault: false,
    });
    expect(placed).toContain('href="/fr/app/library/l1/c1"');
    expect(readable(placed)).toContain("4½ Villeray");
    const mine = render(document([check({ jurisdiction: "QC" })]), "rapport", "fr", {
      libraryId: "l1",
      collectionId: "c0",
      name: "My documents",
      isDefault: true,
    });
    expect(readable(mine)).toContain(fr.console.organisation.defaultName);
    expect(render(document([check({ jurisdiction: "QC" })]))).toContain('href="/fr/app"');
  });

  it("puts the review note at the foot of the report, as a footnote the verdict points to", () => {
    const html = render(document([check({ jurisdiction: "QC" })], {}), "rapport");
    const reviewed = {
      ...check({ jurisdiction: "QC" }),
      report: { ...check({ jurisdiction: "QC" }).report, reviewStatus: "TO_REVIEW_BY_LAWYER" },
    };
    const noted = render(document([reviewed]));
    expect(noted).toContain('href="#fn-1"');
    expect(noted.indexOf(fr.console.analysis.toReview.slice(0, 20))).toBeGreaterThan(
      noted.indexOf('data-testid="technical-details"'),
    );
    expect(html).not.toContain('href="#fn-1"');
  });

  it("offers the signed report as the one primary action and the sharing in the side panel for a real check; neither for a seeded one, which says so", () => {
    const real = render(document([check({ jurisdiction: "QC" })]));
    expect(real).toContain('data-testid="report-download"');
    expect(real).toContain('data-testid="report-aside"');
    const seeded = render(document([check({ ...SEEDED_INPUTS })]));
    expect(seeded).not.toContain('data-testid="report-download"');
    expect(seeded).not.toContain('data-testid="report-aside"');
    expect(readable(seeded)).toContain(fr.console.analysis.seededNote);
  });

  it("says a demo check at the foot, as a note under the report, never inside the technical details or as a box above it (P11)", () => {
    const seeded = render(document([check({ ...SEEDED_INPUTS })]));
    const details = seeded.slice(
      seeded.indexOf('data-testid="technical-details"'),
      seeded.indexOf("</details>", seeded.indexOf('data-testid="technical-details"')),
    );
    expect(readable(details)).not.toContain(fr.console.analysis.seededNote);
    const text = readable(seeded);
    expect(text.indexOf(fr.console.analysis.seededNote)).toBeGreaterThan(text.indexOf(fr.console.library.informative));
    expect(seeded.indexOf(fr.console.analysis.seededNote.slice(0, 20))).toBeGreaterThan(
      seeded.indexOf('data-testid="verdict-band"'),
    );
    expect(readable(render(document([check({ jurisdiction: "QC" })])))).not.toContain(fr.console.analysis.seededNote);
  });

  it("the tabs are routes — Rapport · Document, and Historique only once a second run exists", () => {
    const one = render(document([check({ jurisdiction: "QC" })]));
    expect(one).toContain('href="/fr/app/documents/d1/rapport"');
    expect(one).toContain('href="/fr/app/documents/d1/document"');
    expect(one).not.toContain('href="/fr/app/documents/d1/historique"');
    const two = render(document([check({ jurisdiction: "QC" }), check({ jurisdiction: "QC" }, "a0")]), "historique");
    expect(two).toContain('href="/fr/app/documents/d1/historique"');
    expect(two).toContain('data-testid="tab-historique"');
    expect(readable(two)).toContain(fr.console.reportFace.history);
  });

  it("the document tab holds the file's text, what Verikora read — each kind of amount once —, where it lives, and the file facts", () => {
    const html = render(document([check({ jurisdiction: "QC" })]), "document");
    expect(html).toContain('data-testid="tab-document"');
    expect(html).toContain('data-testid="document-insight"');
    expect(html).toContain('data-testid="document-storage"');
    expect(readable(html).match(/Loyer/g) ?? []).toHaveLength(1);
    expect(readable(html)).toContain("bail-rosemont-5.pdf");
  });

  it("once a report exists, the other checks are actions in the aside, each opening its form in a dialog — no form in the main column", () => {
    nav.search = "";
    const html = render(document([check({ jurisdiction: "QC" })]), "rapport", "fr", {
      libraryId: "l1",
      collectionId: "c1",
      name: "4½ Villeray",
      isDefault: false,
    });
    const main = html.indexOf('data-testid="tab-rapport"');
    const column = html.indexOf('data-testid="report-aside-column"');
    expect(main).toBeGreaterThan(0);
    expect(column).toBeGreaterThan(main);
    expect(html.slice(main, column)).not.toContain("<form");
    const aside = html.slice(html.indexOf('data-testid="other-checks"'));
    expect(html).toContain('data-testid="other-checks"');
    expect(readable(aside)).toContain(fr.console.reportFace.recheck);
    expect(readable(aside)).toContain(fr.console.reportFace.examine);
    expect(aside).toContain('aria-haspopup="dialog"');
    expect(readable(html)).toContain(fr.console.document.facts.collection);
  });

  it("the history opens an earlier run's report (`?run=`): its findings, its download and its sharing follow it", () => {
    nav.search = "run=a0";
    const docs = document([check({ jurisdiction: "QC" }), check({ jurisdiction: "QC" }, "a0", "run_older")]);
    const report = render(docs);
    expect(report.match(/run_older/g)).toHaveLength(1);
    expect(report).not.toContain("run_8f3a2c");
    expect(report).toContain("/analyses/a0/report?lang=fr");
    const history = render(docs, "historique");
    expect(history).toContain('href="/fr/app/documents/d1/rapport?run=a0"');
    expect(history).toContain('href="/fr/app/documents/d1/rapport?run=a1"');
    nav.search = "";
  });

  it("a photo's text (an image-only PDF, read by OCR) is shown under the viewer, so a finding can be found in it", () => {
    const ocr = { kind: "ocr", engine: "tesseract", confidence: 0.9, photos: 2, lowConfidence: false, origin: null };
    expect(render(document([check({ jurisdiction: "QC" })], { textSource: ocr }), "document")).toContain(
      'data-testid="document-text"',
    );
    expect(render(document([check({ jurisdiction: "QC" })]), "document")).not.toContain('data-testid="document-text"');
  });

  it("« Voir dans le fichier » carries the finding in the address: the document tab names it, and leads back to the report", () => {
    nav.search = "finding=QC-LEASE-004";
    const html = render(document([check({ jurisdiction: "QC" })]), "document");
    expect(html).toContain('data-testid="finding-place"');
    expect(readable(html)).toContain("Dépôt de garantie interdit");
    expect(html).toContain('href="/fr/app/documents/d1/rapport"');
    expect(readable(html)).toContain(fr.console.reportFace.backToReport);
    nav.search = "";
    expect(render(document([check({ jurisdiction: "QC" })]), "document")).not.toContain('data-testid="finding-place"');
  });

  it("with no check yet: the report tab says so and offers the checks; a refusal carried in the address is said above the form", () => {
    nav.search = "";
    const none = render(document([]));
    expect(readable(none)).toContain(fr.console.reportFace.notChecked);
    expect(none).not.toContain('data-testid="verdict-band"');
    expect(readable(none)).toContain(fr.console.analysis.complianceTitle);
    nav.search = "refused=RATE_LIMITED";
    expect(readable(render(document([])))).toContain(fr.console.errors.RATE_LIMITED ?? fr.console.errors.UNKNOWN);
    nav.search = "";
    expect(readable(render(document([]), "rapport", "en"))).toContain(en.console.reportFace.notChecked);
  });
});

describe("the business registers in the report (verikora#627)", () => {
  // Synthetic: a fictitious number and a fake register answer, nothing from a real document.
  const registry: RegistryReport = {
    source: "Revenu Québec (SW-340)",
    consultedAt: "2026-10-30T15:00:00.000Z",
    number: "0000000000TQ0001",
    qst: {
      looked: true,
      reason: null,
      signals: [
        {
          signalId: "REG-001",
          family: "figures",
          level: "inhabituel",
          observation: "The QST number printed on the document was not found in the Revenu Québec register.",
          mayIndicate: "A typing error, or a number that belongs to another business.",
          askFor: "Ask the issuer to confirm the QST number.",
          evidence: { field: "issuer QST number" },
          vars: { source: "Revenu Québec" },
        },
      ],
    },
    gstHst: "not-covered",
    neq: "not-authorised",
  };

  it("shows REG-001 as a question, the source with the day it was consulted, and « not looked up » for GST/HST and the NEQ", () => {
    nav.search = "";
    const html = render(document([check({ jurisdiction: "QC" })]), "rapport", "en", null, registry);
    expect(html).toContain('data-testid="registry-checks"');
    const text = readable(html);
    expect(text).toContain("REG-001");
    expect(text).toContain("not found in the Revenu Québec register");
    expect(text).toContain("Ask the issuer to confirm the QST number.");
    expect(text).toContain("Source: Revenu Québec (SW-340), consulted Oct 30, 2026");
    const gst = html.slice(html.indexOf('data-testid="registry-gst"'), html.indexOf('data-testid="registry-neq"'));
    expect(readable(gst)).toContain(en.console.analysis.registry.notLookedUp["not-covered"]);
    expect(readable(html.slice(html.indexOf('data-testid="registry-neq"')))).toContain(
      en.console.analysis.registry.notLookedUp["not-authorised"],
    );
  });

  it("says the same in French", () => {
    nav.search = "";
    const text = readable(render(document([check({ jurisdiction: "QC" })]), "rapport", "fr", null, registry));
    expect(text).toContain(fr.console.analysis.registry.title);
    expect(text).toContain("n'a pas été trouvé dans le registre Revenu Québec");
    expect(text).toContain("Demandez à l'émetteur de confirmer son numéro de TVQ.");
    expect(text).not.toContain("Ask the issuer");
    expect(text).toContain("Source : Revenu Québec (SW-340), consulté le 30 oct. 2026");
    expect(text).toContain(fr.console.analysis.registry.notLookedUp["not-covered"]);
  });

  it("is absent when the document carries no QST number, and a register that did not answer says « not looked up » for the QST too", () => {
    nav.search = "";
    expect(render(document([check({ jurisdiction: "QC" })]))).not.toContain('data-testid="registry-checks"');
    const down: RegistryReport = { ...registry, qst: { looked: false, reason: "unavailable", signals: [] } };
    const text = readable(render(document([check({ jurisdiction: "QC" })]), "rapport", "en", null, down));
    expect(text).toContain(en.console.analysis.registry.notLookedUp.unavailable);
    expect(text).not.toContain("REG-001");
  });
});
