import { org } from "@krizaka/org";
import { footerSettingsProblems, SiteFooter } from "@krizaka/ui/site-footer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/i18n";
import { PUBLIC_ROUTES } from "@/lib/public-build/routes.mjs";
import { PUBLIC_FOOTER, publicFooter, type PublicFooterData } from "@/lib/public-footer";

const internal = (href: string) => href.startsWith("/");

describe("the public export's footer (krizaka-internal#4634)", () => {
  it.each(LOCALES)("%s: every internal link is a page the export holds", (locale) => {
    const config = publicFooter(locale);
    const links = [...config.columns.flatMap((c) => c.links), ...config.legal.links];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links.filter((l) => internal(l.href))) expect(PUBLIC_ROUTES, l.href).toContain(l.href);
  });

  it("a page the export does not hold is dropped, and a column left empty with it", () => {
    const footer: PublicFooterData = {
      ...PUBLIC_FOOTER,
      columns: [
        { id: "a", titleKey: "chrome.navLabel", links: [{ labelKey: "chrome.download", page: "download" }] },
        { id: "b", titleKey: "chrome.navLabel", links: [{ labelKey: "chrome.terms", page: "terms" }] },
        { id: "c", titleKey: "chrome.navLabel", links: [{ labelKey: "chrome.docs", page: "docs" }] },
      ],
    };
    const config = publicFooter("fr", footer);
    expect(config.columns.map((c) => c.id)).toEqual(["c"]);
    expect(config.columns[0]?.links.map((l) => l.href)).toEqual(["/fr/docs"]);
  });

  it("groups its links in columns and shows no version", () => {
    const config = publicFooter("en");
    expect(config.columns.length).toBeGreaterThanOrEqual(2);
    expect(config.legal.showVersion).toBe(false);
  });

  it("the legal line is the publisher's identity from @krizaka/org, never typed", () => {
    const config = publicFooter("fr");
    expect(config.legal.legalName).toBe(org.company.legalName);
    expect(config.legal.neq).toBe(org.company.neq);
    expect(config.legal.city).toBe(org.company.city);
  });

  it("the data passes the footer rules of @krizaka/ui (no duplicate, no empty column, no development address)", () => {
    for (const locale of LOCALES) {
      const config = publicFooter(locale);
      const settings = {
        labelKey: "x",
        columns: config.columns.map((c) => ({
          id: c.id,
          titleKey: c.title,
          links: c.links.map((l) => ({ label: l.label, href: l.href })),
        })),
        legal: { ...config.legal, links: config.legal.links.map((l) => ({ label: l.label, href: l.href })) },
      };
      expect(footerSettingsProblems(settings)).toEqual([]);
    }
  });

  it.each(LOCALES)("%s: renders without a version pill, a sign-in, a download or terms", (locale) => {
    const html = renderToStaticMarkup(
      <SiteFooter current="verikora" family={false} org={org} config={publicFooter(locale)} />,
    );
    expect(html).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(html).not.toMatch(/\/(download|terms|sign-in|login)\b/);
    expect(html).toContain(org.company.legalName);
  });
});
