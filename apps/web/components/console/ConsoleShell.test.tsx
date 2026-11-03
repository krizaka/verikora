import { readFileSync } from "node:fs";

import { KrizakaQueryProvider } from "@krizaka/query";
import { ThemeProvider } from "@krizaka/ui/theme";
import { sectionsFor } from "@yomizaka/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n-client";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => "/fr/app/verifications",
  useSearchParams: () => new URLSearchParams(),
}));

process.env.NEXT_PUBLIC_APP_VERSION = "0.1.0+abc1234";
const { ConsoleShell } = await import("./ConsoleShell");

const MESSAGES = { en: { console: en.console }, fr: { console: fr.console } } as const;
const EMAIL = "eric.persona@example.test";
const render = (
  props: { name?: string; role?: "USER" | "ADMIN"; applicantFiles?: boolean; toDecide?: number } = {},
  locale: "en" | "fr" = "fr",
) =>
  renderToStaticMarkup(
    <ThemeProvider>
      <I18nProvider locale={locale} messages={MESSAGES[locale] as never}>
        <KrizakaQueryProvider>
          <ConsoleShell
            locale={locale}
            email={EMAIL}
            role={props.role ?? "USER"}
            name={props.name}
            applicantFiles={props.applicantFiles}
            toDecide={props.toDecide}
          >
            <p>content</p>
          </ConsoleShell>
        </KrizakaQueryProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
const railLinks = (html: string) => [...html.matchAll(/<a [^>]*data-rail-item[^>]*>/g)].map((m) => m[0]);
const headerOf = (html: string) => html.slice(html.indexOf("<header"), html.indexOf("</header>"));

describe("the signed-in shell, B2 (P14)", () => {
  it("the rail holds two items, Accueil · Vérifications, from the one section map, the active one from the route (krizaka-internal#2001)", () => {
    const html = render();
    const links = railLinks(html);
    expect(links.map((l) => l.match(/href="([^"]+)"/)![1])).toEqual(["/fr/app", "/fr/app/verifications"]);
    expect(links[1]).toContain('aria-current="page"');
    expect(links[0]).not.toContain("aria-current");
    expect(html).not.toMatch(/<a [^>]*data-rail-item[^>]*href="\/fr\/app\/(settings|check|search)"/);
  });

  it("is the section map of core, in its order, with « Dossiers » for the people offered the applicant files (krizaka-internal#2289)", () => {
    const links = railLinks(render({ applicantFiles: true }));
    expect(links.map((l) => l.match(/href="([^"]+)"/)![1])).toEqual(
      sectionsFor("web", { applicantFiles: true }).map((s) => `/fr${s.path}`),
    );
    expect(links.map((l) => l.match(/href="([^"]+)"/)![1])).toEqual([
      "/fr/app",
      "/fr/app/dossiers",
      "/fr/app/verifications",
    ]);
    expect(links[1]).toContain("Dossiers");
  });

  it("the header names the product and carries the DEV chip", () => {
    const header = headerOf(render());
    expect(header).toContain(">Verikora<");
    expect(header).toMatch(/data-testid="app-version"[^>]*>DEV · v0\.1\.0\+abc1234</);
  });

  it("keeps the product's name whole on a phone: the DEV chip waits for `sm`, where there is room (the bar at 360 px is not clipped)", () => {
    const chip = headerOf(render()).match(/<span [^>]*data-testid="app-version"[^>]*>/)![0];
    expect(chip).toMatch(/class="[^"]*\bhidden\b[^"]*\bsm:inline-flex\b/);
  });

  it("the header has ⌘K search, the one gradient action and the account — and no messages, no notifications; the language is under the avatar", () => {
    const header = headerOf(render({ name: "Éric Tremblay" }));
    expect(header).toMatch(/data-slot="search"[^>]*><button[^>]*aria-keyshortcuts="Meta\+K Control\+K"/);
    expect(header).toContain(`>${fr.console.shell.palette.label}<`);
    expect(header).not.toContain(`aria-label="${fr.console.shell.language}: `);
    const action = header.match(/<a [^>]*data-testid="header-check"[^>]*>/)![0];
    expect(action).toContain('aria-label="Vérifier un document"');
    expect(action).toContain('href="/fr/app/check"');
    expect(action).toMatch(/gradient/);
    expect(header).toContain('data-name="Éric Tremblay"');
    expect(header).not.toMatch(/messag|notif/i);
    expect(headerOf(render({}, "en"))).toContain('aria-label="Check a document"');
  });

  it("orders the bar's slots: search, the action, the account", () => {
    const header = headerOf(render({ name: "Éric Tremblay" }));
    const at = (needle: string) => header.indexOf(needle);
    expect(at('data-slot="search"')).toBeGreaterThan(-1);
    expect(at('data-slot="search"')).toBeLessThan(at('data-testid="header-check"'));
    expect(at('data-testid="header-check"')).toBeLessThan(at("data-name="));
  });

  it("is the family's frame: Krizaka UI's AppFrame, no hand-made rail or header, the language and the settings home under the avatar (yomizaka#429)", () => {
    const source = readFileSync(new URL("./ConsoleShell.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/from "@krizaka\/ui\/app-frame"/);
    expect(source).not.toMatch(/RailNav|AppHeader|AccountMenu|LanguageSwitch/);
    expect(source).toMatch(/language=\{\{/);
    expect(source).toMatch(/settings: \{\s*href: href\(CONSOLE_ROUTES\.account\),/);
  });

  it("shows the person's name beside the avatar when there is one, and never the raw e-mail address", () => {
    const named = render({ name: "Éric Tremblay" });
    expect(named).toContain('data-name="Éric Tremblay"');
    expect(named).not.toContain(EMAIL);
    const anonymous = render();
    expect(anonymous).toContain(`data-name="${fr.console.shell.account}"`);
    expect(anonymous).not.toContain(`data-name="${EMAIL}"`);
  });

  it("keeps the skip link and the content landmark", () => {
    const html = render();
    expect(html).toContain('href="#content"');
    expect(html).toMatch(/<main [^>]*id="content"/);
  });
});
