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
      "components/home/BeforeAfter.tsx",
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

  it("says where the data lives as the storage choice has it (ADR-0007): Canadian by default, the customer's own storage when chosen (Y9's leftover)", () => {
    for (const d of [en, fr]) {
      expect(d.landing.what.trust).toMatch(/^(By default|Par défaut)/);
      expect(d.landing.what.trust).toMatch(/own storage|propre stockage/);
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

    it("writes no mono caption: the window bar says nothing, and the owl's quote is not repeated (verikora#457)", () => {
      expect(html).toMatch(/<div class="kz-tpl-stage-bar" aria-hidden="true"><\/div>/);
      expect(html).not.toMatch(/<figure class="kz-quote/);
    });

    it("uses a mono only on code in its content (the bar is the family's NavBar, its language code is @krizaka/ui's)", () => {
      const whole = html.slice(html.indexOf('<main id="content"'), html.indexOf("</main>"));
      // The feature cards hold the app's own screens (inert, drawn with its components, verikora#478): the app's mono (a fingerprint, a run id) is its own, not the page's.
      const main = whole.slice(0, whole.indexOf('id="app"')) + whole.slice(whole.indexOf('id="proof"'));
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

    it("keeps what the product has: the real report in its frame, the engine line, and one way in: the hero's", () => {
      expect(html).toContain('data-testid="before-after"');
      expect(html).not.toContain('data-testid="closing-action"');
      expect(html).toContain('data-testid="closing-data"');
      expect(html).toContain('data-testid="powered-by"');
    });
  });
});
