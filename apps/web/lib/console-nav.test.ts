import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { movedDocumentTab, OLD_DOCUMENT_TABS, SECTIONS } from "@yomizaka/core";
import { describe, expect, it } from "vitest";

import {
  activeNav,
  CHECKS_TABS,
  checksTabHref,
  checksTabOf,
  CONSOLE_ROUTES,
  DOCUMENT_TABS,
  isDocumentTab,
  isSettingsSection,
  movedDocumentHref,
  searchOf,
  SETTINGS_SECTIONS,
  withoutLocale,
} from "./console-nav";
import { ROUTE_STATES } from "./route-state";

const ROOT = join(__dirname, "..");
const app = (p: string) => join(ROOT, "app/[locale]/(app)/app", p);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the rail's active entry comes from the route", () => {
  it.each([
    ["/fr/app", "library"],
    ["/fr/app/documents", "documents"],
    ["/en/app/documents/abc/verifications", "documents"],
    ["/fr/app/library/lib/coll", "library"],
    ["/fr/app/library/lib/coll/folder", "library"],
    ["/fr/app/screening", "files"],
    ["/fr/app/dossiers", "files"],
    ["/fr/app/dossiers/f1", "files"],
    ["/fr/app/verifications", "checks"],
    ["/fr/app/verifications/", "checks"],
    ["/fr/app/check", "checks"],
    ["/fr/app/check/batches/abc", "checks"],
    // Search is the top bar's ⌘K (B2, P14): its full page belongs to the documents it searches, and has no rail entry of its own.
    ["/fr/app/search", "documents"],
    ["/fr/app/search", "documents"],
    ["/fr/app/settings", "account"],
    ["/fr/app/settings/profil", "account"],
  ])("%s → %s", (path, nav) => expect(activeNav(path)).toBe(nav));
  it("its routes are the section map's addresses (yomizaka#319)", () => {
    const routes: Record<string, string> = CONSOLE_ROUTES;
    for (const section of SECTIONS) expect(routes[section.id], section.id).toBe(section.path);
  });
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
    expect(ROUTE_STATES.checksTab).toEqual({
      path: "/app/verifications",
      state: { key: "tab", values: CHECKS_TABS, fallback: "checks" },
    });
  });
  it("has its page, and the old batches address answers 308 to the tab (a batch's own page keeps its address)", () => {
    expect(existsSync(app("verifications/page.tsx"))).toBe(true);
    const old = readFileSync(app("check/batches/page.tsx"), "utf8");
    expect(old).toContain("permanentRedirect(");
    expect(old).toContain("checksTabHref(");
    expect(old).toContain('"lots"');
    expect(existsSync(app("check/batches/[id]/page.tsx"))).toBe(true);
    expect(read("components/console/CheckView.tsx")).toContain('checksTabHref(locale, "lots")');
  });
});

describe("tabs are routes: the URL is the state", () => {
  it("a document has three tabs as routes — the report, the document, the history — and an unknown one is not a tab", () => {
    expect(DOCUMENT_TABS).toEqual(["rapport", "document", "historique"]);
    expect(isDocumentTab("document")).toBe(true);
    expect(isDocumentTab("texte")).toBe(false);
    expect(isDocumentTab("nope")).toBe(false);
    expect(existsSync(app("documents/[id]/[tab]/page.tsx"))).toBe(true);
  });
  it("a bare document address opens on its report; the four old tab addresses answer 308 to their tab; an unknown tab is a 404", () => {
    expect(readFileSync(app("documents/[id]/page.tsx"), "utf8")).toContain("/rapport");
    const page = readFileSync(app("documents/[id]/[tab]/page.tsx"), "utf8");
    expect(page).toContain("movedDocumentHref(asLocale(locale), id, tab, searchOf(await searchParams))");
    expect(page).toContain("permanentRedirect(moved)");
    // By the map's own keys, the query kept (`?refused=`, `?analysis=`).
    expect(movedDocumentTab("verifications")).toBe("rapport");
    expect(movedDocumentTab("constructor")).toBeNull();
    expect(movedDocumentTab("rapport")).toBeNull();
    expect(movedDocumentHref("fr", "d1", "verifications", "refused=PAYWALL&analysis=a0")).toBe(
      "/fr/app/documents/d1/rapport?refused=PAYWALL&analysis=a0",
    );
    expect(movedDocumentHref("en", "d1", "infos")).toBe("/en/app/documents/d1/document");
    expect(movedDocumentHref("fr", "d1", "toString")).toBeNull();
    expect(searchOf({ a: "1", b: ["2", "3"], c: undefined }).toString()).toBe("a=1&b=2&b=3");
    expect(page).toMatch(/isDocumentTab\(tab\)\) \{\s*notFound\(\);?\s*\}/);
    expect(OLD_DOCUMENT_TABS).toEqual({
      infos: "document",
      fichier: "document",
      texte: "document",
      verifications: "rapport",
    });
  });
  it("the view takes its tab from the route and a click navigates (no local tab state)", () => {
    // The view and the run it follows (yomizaka#320: the polling is its own component, LiveAnalysis).
    const view = read("components/console/DocumentView.tsx") + read("components/console/LiveAnalysis.tsx");
    // Y5: the tabs are `Tabs.Nav` links to the tab routes, lit by the current path; the view never holds a tab in state.
    expect(view).toContain("<Tabs.Nav");
    expect(view).toContain("current={`${path}/${tab}`}");
    expect(view).toContain("<Tabs.NavLink key={t} href={`${path}/${t}`}");
    expect(view).toContain("router.push(`${path}/${next}${query}`");
    expect(view).not.toContain("<Tabs.Root");
    expect(view).not.toMatch(/useState\([^)]*"(file|text|rapport|document|historique)"/);
    // A running analysis is asked again until it ends, and the document and the lists are read again then.
    expect(view).toContain("refetchInterval");
    expect(view).toContain("<LiveAnalysis key={a.id}");
  });
  it("search keeps its query in the address; the old French address redirects from the config (308)", () => {
    expect(CONSOLE_ROUTES.search).toBe("/app/search");
    expect(existsSync(app("search/page.tsx"))).toBe(true);
    expect(readFileSync(app("search/page.tsx"), "utf8")).not.toContain("redirect(");
    expect(read("components/console/SearchView.tsx")).toContain("router.replace");
  });
  it("the rail has no local active state", () => {
    const shell = read("components/console/ConsoleShell.tsx");
    expect(shell).toContain("activeNav(path)");
    // The one state of the shell is whether the search palette is open; which entry is active is never kept.
    expect([...shell.matchAll(/useState/g)]).toHaveLength(2);
    expect(shell).toMatch(/const \[searching, setSearching\] = useState\(false\)/);
    expect(shell).toMatch(/currentId=\{active \?\? undefined\}/);
  });
});

describe("the settings' sections are routes", () => {
  it("lists them in order and knows only them", () => {
    expect(SETTINGS_SECTIONS).toEqual([
      "profil",
      "apparence",
      "securite",
      "facturation",
      "stockage",
      "signets",
      "donnees",
    ]);
    expect(isSettingsSection("securite")).toBe(true);
    expect(isSettingsSection("admin")).toBe(false);
  });
  it("each section has its page route, and the settings index redirects to the first", () => {
    const page = (p: string) => existsSync(join(ROOT, "app/[locale]/(app)/app/settings", p, "page.tsx"));
    expect(page("[section]")).toBe(true);
    expect(readFileSync(join(ROOT, "app/[locale]/(app)/app/settings/page.tsx"), "utf8")).toContain(
      "/app/settings/profil",
    );
  });
  it("every section is under the account entry of the rail", () => {
    for (const s of SETTINGS_SECTIONS) expect(activeNav(`/fr/app/settings/${s}`)).toBe("account");
  });
});

describe("the shell follows Orazaka's pattern (krizaka/yomizaka#278, the UX review's Y1)", () => {
  const shell = read("components/console/ConsoleShell.tsx");
  it("the rail holds the section map's destinations only (yomizaka#319) — no footer, no « + » action, no settings cog", () => {
    // The rail is the frame's (`AppFrame`, yomizaka#429): the shell gives it the section map and nothing at the foot.
    expect(shell).toContain('sectionsFor("web", { applicantFiles })');
    expect(shell).toContain("href: href(section.path)");
    expect(shell).not.toContain('place: "foot"');
    expect(shell).not.toMatch(/RailNav|PlusIcon\s*size=\{22\}/);
  });
  it("the header names the product, carries the DEV chip, and « Vérifier un document » as its gradient cut button, in the `primary` slot (B2, P14)", () => {
    expect(shell).toContain("name={PRODUCT_NAME}");
    expect(shell).not.toContain("titleOf(");
    expect(shell).toMatch(/chips=\{[\s\S]*data-testid="app-version"/);
    expect(shell).toMatch(
      /<ButtonLink\b(?=[^>]*\bvariant="gradient")(?=[^>]*\bshape="cut")(?=[^>]*aria-label=\{say\("shell\.checkAction"\)\})[^>]*data-testid="header-check"/,
    );
  });
  it("the account menu has profile, settings, credits and usage, a labelled theme row and sign out; the name shows only when there is one; nothing sends the owner elsewhere", () => {
    for (const id of ["profile", "settings", "billing"]) expect(shell).toMatch(new RegExp(`${id}: \\{`));
    // The frame draws the account menu in its order (language, theme and sign out under the places): the shell gives it the data.
    expect(shell).toContain("language={{");
    expect(shell).toContain("onSignOut:");
    expect(shell).not.toMatch(/AccountMenu|LanguageSwitch|ThemeToggle/);
    expect(shell).not.toContain("name ?? email}");
    for (const l of ["en", "fr"]) {
      const m = JSON.parse(read(`messages/${l}.json`));
      expect(JSON.stringify(m)).not.toMatch(/Ouvrir la plateforme|Open the platform/i);
    }
  });
  it("the type picker is a labelled choice of cards with a hint each, asked only for an uncertain kind (yomizaka#318), « auto » the route's fallback", () => {
    const view = read("components/console/CheckView.tsx");
    expect(view).toContain("library.kindPick");
    expect(view).toContain("<ChoiceCards");
    expect(view).not.toContain("ChoiceGrid");
    expect(view).toContain("library.kindHints");
    expect(view).not.toContain("RadioGroup.Segment");
    expect(ROUTE_STATES.checkKind.state.fallback).toBe("auto");
  });
  it("every signed-in page draws its h1 with PageHeader — the document with DetailLayout's title (Y5) — (the header names the product, never the page)", () => {
    for (const file of [
      "components/console/LibraryView.tsx",
      "components/console/CheckView.tsx",
      "components/console/ChecksView.tsx",
      "components/console/SearchView.tsx",
      "components/console/AllDocuments.tsx",
      "components/console/PlaceView.tsx",
      "components/console/BatchProgress.tsx",
      "app/[locale]/(app)/app/settings/[section]/page.tsx",
      "app/[locale]/(app)/app/welcome/page.tsx",
    ]) {
      expect(read(file), file).toContain('from "@krizaka/ui/page-header"');
      expect(read(file), file).toMatch(/<PageHeader\b/);
      expect(read(file), file).not.toMatch(/<h1\b/);
    }
    const view = read("components/console/DocumentView.tsx");
    expect(view).toContain('from "@krizaka/ui/detail-layout"');
    expect(view).toMatch(/<DetailLayout\b/);
    expect(view).toContain("title={title}");
    expect(view).not.toMatch(/<h1\b/);
    expect(view).not.toContain("@krizaka/ui/page-header");
    expect(read("components/screening/LandlordScreening.tsx")).toMatch(/<h1\b/);
  });
});
