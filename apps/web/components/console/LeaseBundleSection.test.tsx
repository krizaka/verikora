import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import type { LeaseBundle } from "@/lib/lease-bundle";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { LeaseBundleSection } from "./LeaseBundleSection";

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const wrap = (node: React.ReactNode, locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      {node}
    </I18nProvider>,
  );

const bundle = (reviewStatus: string | null): LeaseBundle => ({
  leaseId: "l1",
  documents: [
    { id: "l1", title: "Bail 2026", role: "lease", checked: true },
    { id: "a1", title: "Annexe A", role: "annex", checked: false },
  ],
  rulesets: [{ jurisdiction: "QC", rulesetId: "qc-residential-lease", rulesetVersion: "1", reviewStatus }],
  lines: [
    {
      documentId: "l1",
      documentTitle: "Bail 2026",
      role: "lease",
      line: 12,
      quote: "Le locataire renonce",
      ruleId: "r1",
      article: "C.c.Q. art. 1893",
      severity: "BLOCKING",
      verdict: "FAIL",
    },
    {
      documentId: "l1",
      documentTitle: "Bail 2026",
      role: "lease",
      line: 3,
      quote: null,
      ruleId: "r2",
      article: "C.c.Q. art. 1901",
      severity: "MAJOR",
      verdict: "PASS",
    },
  ],
});

describe("the bundle screen (verikora#499)", () => {
  it("lists the documents with their role, then each finding with document, line, quote and article", () => {
    const html = wrap(<LeaseBundleSection bundle={bundle(null)} />);
    expect(html).toContain('data-testid="lease-bundle"');
    expect(html).toContain(fr.console.bundle.roles.annex);
    expect(html).toContain(fr.console.bundle.notChecked);
    expect(html).toContain("ligne 12");
    expect(html).toContain("Le locataire renonce");
    expect(html).toContain("C.c.Q. art. 1893");
  });
  it("shows what needs a look only: a met rule is not listed", () => {
    expect(wrap(<LeaseBundleSection bundle={bundle(null)} />)).not.toContain("C.c.Q. art. 1901");
  });
  it("says the rules await a lawyer's reading only while they do", () => {
    expect(wrap(<LeaseBundleSection bundle={bundle("TO_REVIEW_BY_LAWYER")} />, "en")).toContain(
      en.console.bundle.toReview,
    );
    expect(wrap(<LeaseBundleSection bundle={bundle(null)} />, "en")).not.toContain('data-testid="bundle-review"');
  });
  it("gives no verdict or advice wording", () => {
    for (const m of [en.console.bundle, fr.console.bundle])
      expect(JSON.stringify(m)).not.toMatch(/conforme|compliant|approuv|approved|vous devez|you should/i);
  });
});
