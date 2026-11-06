import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { footerLine, org } from "@krizaka/org";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/SiteFooter";

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

  it("each public page renders <SiteFooter/> once, after its main, and nothing else renders a footer", () => {
    for (const page of ["page.tsx", "privacy/page.tsx", "docs/page.tsx", "download/page.tsx"]) {
      const source = read(`app/[locale]/${page}`);
      expect(source.match(/<SiteFooter\b/g)).toHaveLength(1);
      expect(source.lastIndexOf("</main>")).toBeLessThan(source.indexOf("<SiteFooter "));
    }
    const offenders = [...files("app"), ...files("components")]
      .filter((f) => /\.tsx$/.test(f) && !/components\/SiteFooter\.tsx$/.test(f))
      .filter((f) => /<footer\b|<FamilyFooter\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("renders one footer landmark, signed « A Krizaka product », with no family navigation", () => {
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(SiteFooter({ locale }));
      expect(html.match(/<footer\b/g)).toHaveLength(1);
      expect(html).toContain('href="https://www.krizaka.com"');
      expect(html).not.toMatch(/Krizaka family|Famille Krizaka/);
    }
  });

  it("reads the signature line and the legal links from @krizaka/org, none typed here", () => {
    const footer = read("components/SiteFooter.tsx");
    expect(footer).toContain('from "@krizaka/org"');
    expect(footer).toContain("org={org}");
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(SiteFooter({ locale })).replaceAll("&#x27;", "'");
      expect(html).toContain(footerLine(locale));
      for (const link of org.footer.legal) expect(html).toContain(link.label[locale]);
    }
  });

  it("shows « Privacy » and « Terms » once: in the legal line, not also in the links row", () => {
    for (const locale of ["en", "fr"] as const) {
      const html = renderToStaticMarkup(SiteFooter({ locale }));
      for (const link of org.footer.legal) {
        expect(html.split(`>${link.label[locale]}<`)).toHaveLength(2);
      }
      expect(html).not.toContain(`href="/${locale}/privacy"`);
      expect(html).not.toContain(`href="/${locale}/terms"`);
    }
  });
});
