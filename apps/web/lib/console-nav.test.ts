import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { activeNav, CHECKS_TABS, checksTabHref, checksTabOf, CONSOLE_ROUTES, DOCUMENT_TABS, isDocumentTab, isSettingsSection, SETTINGS_SECTIONS, withoutLocale } from "./console-nav";
import { ROUTE_STATES } from "./route-state";

const ROOT = join(__dirname, "..");
const app = (p: string) => join(ROOT, "app/[locale]/(app)/app", p);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the rail's active entry comes from the route", () => {
  it.each([
    ["/fr/app", "library"],
    ["/en/app/documents/abc/verifications", "library"],
    ["/fr/app/bibliotheque/lib/coll", "library"],
    ["/fr/app/bibliotheque/lib/coll/folder", "library"],
    ["/fr/app/screening", "library"],
    ["/fr/app/verifications", "checks"],
    ["/fr/app/verifications/", "checks"],
    ["/fr/app/verifier", "checks"],
    ["/fr/app/verifier/lots/abc", "checks"],
    ["/fr/app/recherche?q=bail".split("?")[0]!, "search"],
    ["/fr/app/search", "search"],
    ["/fr/app/settings", "account"],
    ["/fr/app/settings/profil", "account"],
  ])("%s → %s", (path, nav) => expect(activeNav(path)).toBe(nav));
  it("an unknown path belongs to no entry", () => {
    expect(activeNav("/fr/elsewhere")).toBeNull();
  });
  it("strips the language segment only", () => {
    expect(withoutLocale("/fr/app/x")).toBe("/app/x");
    expect(withoutLocale("/frog/app")).toBe("/frog/app");
  });
});

describe("Vérifications is a destination; its « Lots » tab lives in the address", () => {
  it("knows its two tabs, falls back on the list, and keeps the first tab's address clean", () => {
    expect(CHECKS_TABS).toEqual(["checks", "lots"]);
    expect(checksTabOf("lots")).toBe("lots");
    expect(checksTabOf("checks")).toBe("checks");
    expect(checksTabOf(null)).toBe("checks");
    expect(checksTabOf("nope")).toBe("checks");
    expect(checksTabHref("fr", "checks")).toBe("/fr/app/verifications");
    expect(checksTabHref("en", "lots")).toBe("/en/app/verifications?tab=lots");
    expect(ROUTE_STATES.checksTab).toEqual({ path: "/app/verifications", state: { key: "tab", values: CHECKS_TABS, fallback: "checks" } });
  });
  it("has its page, and the old batches address answers 308 to the tab (a batch's own page keeps its address)", () => {
    expect(existsSync(app("verifications/page.tsx"))).toBe(true);
    const old = readFileSync(app("verifier/lots/page.tsx"), "utf8");
    expect(old).toContain("permanentRedirect(");
    expect(old).toContain('checksTabHref(');
    expect(old).toContain('"lots"');
    expect(existsSync(app("verifier/lots/[id]/page.tsx"))).toBe(true);
    expect(read("components/console/CheckView.tsx")).toContain('checksTabHref(locale, "lots")');
  });
});

describe("tabs are routes: the URL is the state", () => {
  it("each document tab has its own route, and an unknown one is not a tab", () => {
    expect(DOCUMENT_TABS).toEqual(["infos", "verifications", "fichier", "texte"]);
    expect(isDocumentTab("texte")).toBe(true);
    expect(isDocumentTab("nope")).toBe(false);
    expect(existsSync(app("documents/[id]/[tab]/page.tsx"))).toBe(true);
  });
  it("a bare document address opens on its information (a redirect), and an unknown tab is a 404", () => {
    expect(readFileSync(app("documents/[id]/page.tsx"), "utf8")).toContain("/infos");
    expect(readFileSync(app("documents/[id]/[tab]/page.tsx"), "utf8")).toMatch(/isDocumentTab\(tab\)\) notFound\(\)/);
  });
  it("the view takes its tab from the route and a click navigates (no local tab state)", () => {
    const view = read("components/console/DocumentView.tsx");
    expect(view).toContain("value={tab}");
    expect(view).toContain("router.push(`/${locale}/app/documents/${initial.id}/${next}`");
    expect(view).not.toMatch(/useState\([^)]*"(file|text)"/);
  });
  it("search keeps its query in the address, and the old address redirects", () => {
    expect(CONSOLE_ROUTES.search).toBe("/app/recherche");
    expect(existsSync(app("recherche/page.tsx"))).toBe(true);
    expect(readFileSync(app("search/page.tsx"), "utf8")).toContain("redirect(");
    expect(read("components/console/SearchView.tsx")).toContain("router.replace");
  });
  it("the rail has no local active state", () => {
    const shell = read("components/console/ConsoleShell.tsx");
    expect(shell).toContain("activeNav(path)");
    expect(shell).not.toMatch(/useState/);
  });
});

describe("the settings' sections are routes", () => {
  it("lists them in order and knows only them", () => {
    expect(SETTINGS_SECTIONS).toEqual(["profil", "securite", "facturation", "stockage", "donnees"]);
    expect(isSettingsSection("securite")).toBe(true);
    expect(isSettingsSection("admin")).toBe(false);
  });
  it("each section has its page route, and the settings index redirects to the first", () => {
    const page = (p: string) => existsSync(join(ROOT, "app/[locale]/(app)/app/settings", p, "page.tsx"));
    expect(page("[section]")).toBe(true);
    expect(readFileSync(join(ROOT, "app/[locale]/(app)/app/settings/page.tsx"), "utf8")).toContain("/app/settings/profil");
  });
  it("every section is under the account entry of the rail", () => {
    for (const s of SETTINGS_SECTIONS) expect(activeNav(`/fr/app/settings/${s}`)).toBe("account");
  });
});

describe("the shell follows Orazaka's pattern (krizaka/yomizaka#278, the UX review's Y1)", () => {
  const shell = read("components/console/ConsoleShell.tsx");
  const railItems = shell.match(/<RailNav\.Item\b/g) ?? [];
  it("the rail holds the three destinations only — no footer, no « + » action, no settings cog", () => {
    expect(railItems).toHaveLength(3);
    for (const route of [CONSOLE_ROUTES.library, CONSOLE_ROUTES.checks, CONSOLE_ROUTES.search]) expect(shell).toContain(`href(CONSOLE_ROUTES.${Object.entries(CONSOLE_ROUTES).find(([, v]) => v === route)![0]})`);
    expect(shell).not.toContain("footer={");
    expect(shell).not.toMatch(/<RailNav\.Item[^>]*PlusIcon/);
    expect(shell).not.toMatch(/<RailNav\.Item[^>]*SettingsIcon/);
  });
  it("the header names the product, carries the DEV chip, and « Vérifier un document » as its primary cut button", () => {
    expect(shell).toContain('name="Yomizaka"');
    expect(shell).not.toContain("titleOf(");
    expect(shell).toMatch(/chips=\{[\s\S]*data-testid="app-version"/);
    expect(shell).toMatch(/<ButtonLink\b(?=[^>]*\bvariant="primary")(?=[^>]*\bshape="cut")(?=[^>]*aria-label=\{say\("shell\.checkAction"\)\})[^>]*data-testid="header-check"/);
  });
  it("the account menu has profile, settings, billing, language, a labelled theme row and sign out; the name shows only when there is one; nothing sends the owner elsewhere", () => {
    for (const id of ["profile", "settings", "billing"]) expect(shell).toContain(`id: "${id}"`);
    expect(shell).toContain("language={{");
    expect(shell).toContain('data-testid="theme-row"');
    expect(shell).toContain("signOut={{");
    expect(shell).toContain("showName={Boolean(name)}");
    expect(shell).not.toContain("name ?? email}");
    for (const l of ["en", "fr"]) {
      const m = JSON.parse(read(`messages/${l}.json`));
      expect(JSON.stringify(m)).not.toMatch(/Ouvrir la plateforme|Open the platform/i);
    }
  });
  it("the type picker is a labelled choice (a choice grid under the drop zone, Y4) with « auto » preselected and a hint each", () => {
    const view = read("components/console/CheckView.tsx");
    expect(view).toContain("library.kindPick");
    expect(view).toContain("<ChoiceGrid");
    expect(view).toContain("library.kindHints");
    expect(view).not.toContain("RadioGroup.Segment");
    expect(ROUTE_STATES.checkKind.state.fallback).toBe("auto");
  });
  it("every signed-in page draws its h1 with PageHeader (the header names the product, never the page)", () => {
    for (const file of ["components/console/LibraryView.tsx", "components/console/CheckView.tsx", "components/console/ChecksView.tsx", "components/console/SearchView.tsx", "components/console/DocumentView.tsx", "components/console/PlaceView.tsx", "components/console/BatchProgress.tsx", "app/[locale]/(app)/app/settings/[section]/page.tsx", "app/[locale]/(app)/app/bienvenue/page.tsx"]) {
      expect(read(file), file).toContain('from "@krizaka/ui/page-header"');
      expect(read(file), file).toMatch(/<PageHeader\b/);
      expect(read(file), file).not.toMatch(/<h1\b/);
    }
    expect(read("components/screening/LandlordScreening.tsx")).toMatch(/<h1\b/);
  });
});
