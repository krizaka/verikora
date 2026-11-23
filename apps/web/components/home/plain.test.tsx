import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { ThemeProvider } from "@krizaka/ui/theme";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr",
}));

import Home from "@/app/[locale]/page";
import { heroFinding } from "@/lib/landing";
import { ruleTitle } from "@/lib/rule-text";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

/**
 * The public site, plain (design § 3.2, P10, verikora#327): it is the product's site, not a Cahier site. No red mono
 * eyebrow, no figures row under the hero, no mono captions, a bento without an orphan card. A mono only for code
 * (`<code>`, `<pre>`: a hash, a key, a link), never the margin's red for text.
 */
const WEB = join(__dirname, "../..");
/** The public pages and the components they draw: everything outside the app, the console and the administration. */
const PUBLIC = [
  "app/[locale]/page.tsx",
  "app/[locale]/not-found.tsx",
  "app/[locale]/confirm-email",
  "app/[locale]/download",
  "app/[locale]/privacy",
  "app/[locale]/screening",
  "app/[locale]/terms",
  "app/[locale]/(app)/app/verifications/report",
  "app/[locale]/verify-email",
  "components/screening",
  "components/BarSession.tsx",
  "components/ClosingNoteView.tsx",
  "components/EmailTokenPage.tsx",
  "components/SiteChrome.tsx",
  "components/SiteFooter.tsx",
  "components/VerifyForm.tsx",
];

function sources(path: string): { name: string; source: string }[] {
  const full = join(WEB, path);
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => sources(join(path, f)));
  return /\.tsx?$/.test(path) && !path.includes(".test.") ? [{ name: path, source: readFileSync(full, "utf8") }] : [];
}

/** The tag each `font-mono` sits on (the nearest `<tag` before it): only `code` and `pre` may carry it. */
function monoTags(markup: string): string[] {
  return [...markup.matchAll(/font-mono/g)].map(
    (m) => [...markup.slice(0, m.index).matchAll(/<([a-zA-Z][\w.]*)/g)].pop()?.[1] ?? "(none)",
  );
}

describe("the public site, plain (P10)", () => {
  const files = PUBLIC.flatMap(sources);

  it("reads the home, the verification page and the public components", () => {
    for (const name of [
      "app/[locale]/page.tsx",
      "app/[locale]/(app)/app/verifications/report/page.tsx",
      "components/SiteChrome.tsx",
    ])
      expect(files.map((f) => f.name)).toContain(name);
  });

  it("uses a mono only on code: every font-mono sits on a <code> or a <pre>", () => {
    const outside = files.flatMap((f) =>
      monoTags(f.source)
        .filter((tag) => tag !== "code" && tag !== "pre")
        .map((tag) => `${f.name} › <${tag}>`),
    );
    expect(outside).toEqual([]);
  });

  it("never paints text in the margin's red, and sets no eyebrow", () => {
    expect(
      files.filter((f) => /paper-rule-margin|kz-eyebrow|text-danger|\beyebrow=/.test(f.source)).map((f) => f.name),
    ).toEqual([]);
  });

  it("never draws a Cahier face", () => {
    expect(files.filter((f) => /font-serif|Young Serif|Courier/.test(f.source)).map((f) => f.name)).toEqual([]);
  });

  it("keeps the storage sentence off the home: the privacy notice says where the data lives (krizaka-internal#2562)", () => {
    for (const d of [en, fr]) {
      expect(JSON.stringify([d.landing, d.productPage])).not.toMatch(/Toronto/);
    }
  });

  describe("the home, rendered (the product page template, krizaka-internal#4692)", async () => {
    const render = async (locale: "en" | "fr") =>
      renderToStaticMarkup(<ThemeProvider>{await Home({ params: Promise.resolve({ locale }) })}</ThemeProvider>);
    const pages = { en: await render("en"), fr: await render("fr") };

    it("draws the template: the promise, the recorded finding with its article, the journey, the clause demo, the limits, one way in", () => {
      for (const html of Object.values(pages)) {
        expect(html).toContain("kz-pp-hero");
        expect(html).toContain("kz-story");
        expect(html).toContain("kz-clause");
        expect(html).toContain("kz-pp-limits");
        expect(html).toContain("kz-pp-closing");
        expect(html).toContain("art. 1936");
        expect(html).toContain('id="proof"');
        expect(html).toContain('id="what"');
      }
    });

    it("keeps the company's status sentence and no date promise", () => {
      expect(pages.en).toContain(en.landing.status.development);
      expect(pages.fr).toContain(fr.landing.status.development.replace(/'/g, "&#x27;"));
      for (const html of Object.values(pages)) {
        expect(html).not.toMatch(/bientôt|soon|prochainement|coming/i);
      }
    });

    it("says what it does not do, in each language, and tutoies no one", () => {
      expect(pages.en).toContain(en.productPage.limits.items.decide);
      expect(pages.fr).toContain(fr.productPage.limits.items.decide.replace(/'/g, "&#x27;"));
      expect(JSON.stringify(fr.productPage)).not.toMatch(/\b(tu|ton|ta|tes|toi|ttes)\b/i);
    });

    it("never shows a French rule title on the /en page", () => {
      const finding = heroFinding();
      const [titleFr, titleEn] = [
        ruleTitle(finding.ruleId, "fr", finding.title),
        ruleTitle(finding.ruleId, "en", finding.title),
      ];
      expect(titleFr).not.toBe(titleEn);
      expect(pages.en).toContain(titleEn);
      expect(pages.en).not.toContain(titleFr.replace(/'/g, "&#x27;"));
    });
  });
});
