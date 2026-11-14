import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { footerLine, org } from "@krizaka/org";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductFooter } from "@/components/SiteFooter";

// One footer, one contentinfo: @krizaka/ui's SiteFooter in product mode, rendered once per page after its <main>.
const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(ROOT, rel)).isDirectory() ? files(rel) : [rel];
  });
}

describe("the pages render exactly one footer", () => {
  it("the footer is the family's SiteFooter without family columns — the hand-made one is gone", () => {
    const footer = read("components/SiteFooter.tsx");
    expect(footer).toContain('from "@krizaka/ui/site-footer"');
    expect(footer).toContain("family={false}");
    expect(footer).not.toMatch(/<footer\b/);
    expect(footer).not.toContain("dev-environment-notice</p>");
  });

  it("each public page renders <ProductFooter/> once, after its main, and nothing else renders a footer", () => {
    for (const page of ["page.tsx", "privacy/page.tsx", "docs/page.tsx", "download/page.tsx"]) {
      const source = read(`app/[locale]/${page}`);
      expect(source.match(/<ProductFooter\b/g)).toHaveLength(1);
      expect(source.lastIndexOf("</main>")).toBeLessThan(source.indexOf("<ProductFooter "));
    }
    const offenders = [...files("app"), ...files("components")]
      .filter((f) => /\.tsx$/.test(f) && !/components\/SiteFooter\.tsx$/.test(f))
      .filter((f) => /<footer\b|<FamilyFooter\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("renders one footer landmark, signed « A Krizaka product », with no family navigation", () => {
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(ProductFooter({ locale }));
      expect(html.match(/<footer\b/g)).toHaveLength(1);
      expect(html).toContain('href="https://www.krizaka.com"');
      expect(html).not.toMatch(/Krizaka family|Famille Krizaka/);
    }
  });

  it("reads the signature line from @krizaka/org, none typed here", () => {
    const footer = read("components/SiteFooter.tsx");
    expect(footer).toContain('from "@krizaka/org"');
    expect(footer).toContain("org={org}");
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(ProductFooter({ locale })).replaceAll("&#x27;", "'");
      expect(html).toContain(footerLine(locale));
    }
  });

  it("shows « Privacy » and « Terms » once, in the legal line, pointing to Verikora's own pages (its policy, its Law 25 officer), never krizaka.com", () => {
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(ProductFooter({ locale }));
      for (const link of org.footer.legal) {
        expect(html.split(`>${link.label[locale]}<`)).toHaveLength(2);
        expect(html).not.toContain(link.url[locale]);
      }
      for (const page of ["privacy", "terms"]) {
        expect(html.split(`href="/${locale}/${page}"`)).toHaveLength(2);
      }
      const legal = /<div[^>]*>((?:(?!<div).)*?href="\/[a-z]{2}\/privacy".*?)<\/div>/s.exec(html)?.[1] ?? "";
      expect(legal).toContain(`href="/${locale}/terms"`);
    }
  });
});
