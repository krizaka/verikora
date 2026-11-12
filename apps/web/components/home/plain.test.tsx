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
  "components/home",
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

/** The bento's spans, row by row, on its six columns: `sm` 2, `md` 3, `lg` 4. A row left unfilled holds an orphan. */
function bentoRows(sizes: readonly (string | undefined)[]): number[] {
  const span = { lg: 4, md: 3 } as Record<string, number>;
  const rows: number[] = [0];
  for (const s of sizes) {
    const w = span[s ?? ""] ?? 2;
    if (rows[rows.length - 1]! + w > 6) rows.push(0);
    rows[rows.length - 1] += w;
  }
  return rows;
}

describe("the public site, plain (P10)", () => {
  const files = PUBLIC.flatMap(sources);

  it("reads the home, the verification page and the public components", () => {
    for (const name of [
      "app/[locale]/page.tsx",
      "app/[locale]/(app)/app/verifications/report/page.tsx",
      "components/home/HeroFinding.tsx",
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

  it("counts an orphan when a row of the bento is not full", () => {
    expect(bentoRows(["md", "sm", "sm"])).toEqual([5, 2]);
    expect(bentoRows([undefined, undefined, undefined])).toEqual([6]);
    expect(bentoRows(["md", "md"])).toEqual([6]);
  });

  it("keeps the storage sentence off the home: the privacy notice says where the data lives (krizaka-internal#2562)", () => {
    for (const d of [en, fr]) {
      expect(JSON.stringify(d.landing)).not.toMatch(/Toronto/);
    }
  });

  describe("the home, rendered", async () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>{await Home({ params: Promise.resolve({ locale: "fr" }) })}</ThemeProvider>,
    );

    it("has no eyebrow above the promise and no figures row under the hero", () => {
      expect(html).toContain("kz-hero-title");
      expect(html).not.toContain("kz-eyebrow");
      expect(html).not.toContain("kz-tpl-band");
    });

    it("writes no mono caption: the window bar says « Un bail · exécution enregistrée » in the sans, and the owl's quote is not repeated (verikora#457)", () => {
      expect(html).toMatch(
        /<div class="kz-tpl-stage-bar" aria-hidden="true"><span>Un bail · exécution enregistrée<\/span><\/div>/,
      );
      expect(html).not.toMatch(/<figure class="kz-quote/);
    });

    it("uses a mono only on code in its content (the bar is the family's NavBar, its language code is @krizaka/ui's)", () => {
      const whole = html.slice(html.indexOf('<main id="content"'), html.indexOf("</main>"));
      // The report is the app's own view (krizaka-internal#2562): the app's mono (a fingerprint, a run id) is its own, not the page's.
      const main =
        whole.slice(0, whole.indexOf('data-testid="real-report"')) + whole.slice(whole.indexOf('id="applicant"'));
      expect(main.length).toBeGreaterThan(0);
      expect(monoTags(main).filter((tag) => tag !== "code" && tag !== "pre")).toEqual([]);
      // `Facts` are « a few mono words on one line » in the blocks: the lead already says who it is for, in the sans.
      expect(main).not.toContain("kz-facts");
    });

    it("lays the bento out without an orphan: every row of its six columns is full", () => {
      const bento = html.match(/<ul class="kz-tpl-bento">(.*?)<\/ul>/s)?.[1] ?? "";
      const sizes = [...bento.matchAll(/<li( data-size="(\w+)")?/g)].map((m) => m[2]);
      expect(sizes.length).toBeGreaterThan(0);
      expect(bentoRows(sizes).every((r) => r === 6)).toBe(true);
    });

    it("keeps what the product has: one finding of the recorded run, the engine line; one primary in the hero and the same in the closing, on a plain surface", () => {
      expect(html).toContain('data-testid="hero-finding"');
      expect(html).not.toContain('data-testid="before-after"');
      expect(html).toContain('data-testid="hero-primary"');
      expect(html).toContain('data-testid="closing-primary"');
      expect(html).toContain('data-testid="closing-tenant"');
      expect(html).not.toContain('data-testid="closing-data"');
      expect(html).not.toMatch(/class="kz-cta\b/);
      expect(html).toContain('data-testid="powered-by"');
    });
  });
});
