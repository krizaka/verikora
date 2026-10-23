import { KrizakaQueryProvider } from "@krizaka/query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { CheckView } from "./CheckView";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }), usePathname: () => "/fr/app/verifier", useSearchParams: () => new URLSearchParams() }));

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const readable = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ");
const render = (locale: "en" | "fr" = "fr") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
      <KrizakaQueryProvider>
        <CheckView />
      </KrizakaQueryProvider>
    </I18nProvider>,
  );

describe("« Vérifier un document » (the UX review's Y4)", () => {
  it("has one h1, the drop zone first and the kind under it as a choice of five with Automatique first", () => {
    const html = render();
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const zone = html.indexOf(fr.console.library.dropTitle);
    const choice = html.indexOf('data-testid="kind-choice"');
    expect(zone).toBeGreaterThan(0);
    expect(choice).toBeGreaterThan(zone);
    const text = readable(html);
    for (const kind of ["auto", "lease", "contract", "invoice", "other"] as const) {
      expect(text).toContain(fr.console.kinds[kind]);
      expect(text).toContain(fr.console.library.kindHints[kind]);
    }
    expect(text).toContain(fr.console.library.kindPick);
  });

  it("asks the options only once files are known, and says the check is informative", () => {
    const html = render();
    expect(html).not.toContain('data-testid="check-options"');
    expect(html).not.toContain('data-testid="keep-choice"');
    expect(html).not.toContain('data-testid="group-photos"');
    expect(readable(html)).toContain(fr.console.library.informative);
    expect(readable(render("en"))).toContain(en.console.library.informative);
  });
});
