import {
  CHECKS_TABS,
  type ChecksTab,
  DOCUMENT_TABS,
  type DocumentTab,
  movedDocumentTab,
  type SectionId,
} from "@verikora/core";

/**
 * The signed-in space's navigation, as data and pure functions (the active state comes from the route, never from local
 * state). The rail draws the one section map of `@verikora/core` (verikora#319) — Bibliothèque · Dossiers (offered with the
 * applicant-file flow) · Vérifications · Recherche —, the account owns the settings, and the header owns the one action of
 * every screen, « Vérifier un document », whose task page (`check`) lights Vérifications.
 */
export type NavId = SectionId | "account";

export const CONSOLE_ROUTES = {
  library: "/app",
  files: "/app/dossiers",
  documents: "/app/documents",
  checks: "/app/verifications",
  check: "/app/check",
  search: "/app/search",
  account: "/app/settings",
  plans: "/app/plans",
} as const;

/** The tabs of the Vérifications destination (the map's, `@verikora/core`); the second lives in the address: `/app/verifications?tab=lots`. */
export { CHECKS_TABS, type ChecksTab };
export const CHECKS_TAB_KEY = "tab";
/** The tab named by the address; an unknown or missing one is the list of checks (a stale link never breaks the page). */
export const checksTabOf = (raw: string | null | undefined): ChecksTab =>
  CHECKS_TABS.find((t) => t === raw) ?? "checks";
/** The address of a tab: the first keeps the address clean, the others name themselves. */
export const checksTabHref = (locale: "en" | "fr", tab: ChecksTab): string => {
  const query = tab === CHECKS_TABS[0] ? "" : `?${CHECKS_TAB_KEY}=${tab}`;
  return `/${locale}${CONSOLE_ROUTES.checks}${query}`;
};

/** The path without its language segment: `/fr/app/documents/x` → `/app/documents/x`. */
export const withoutLocale = (path: string) => path.replace(/^\/(en|fr)(?=\/|$)/, "") || "/";

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which rail entry a path belongs to. The rail holds Home and Checks, and « Dossiers » between them for a person offered the applicant files (krizaka-internal#2289): the applicant files and their screening light it; the documents, the search page and the collections belong to the home, the task page to the checks; an unknown path to none. */
export function activeNav(path: string): NavId | null {
  const p = withoutLocale(path).replace(/\/$/, "") || "/";
  if (under(p, CONSOLE_ROUTES.checks) || under(p, CONSOLE_ROUTES.check)) return "checks";
  // Search is the top bar's ⌘K; its full page belongs to the documents it searches.
  if (under(p, CONSOLE_ROUTES.search)) return "library";
  if (under(p, CONSOLE_ROUTES.account)) return "account";
  if (under(p, CONSOLE_ROUTES.files) || under(p, "/app/screening")) return "files";
  if (under(p, CONSOLE_ROUTES.documents)) return "library";
  if (p === CONSOLE_ROUTES.library || under(p, "/app/library")) return "library";
  return null;
}

/** The tabs of a document, each a route: /documents/[id]/<tab> (the URL is the state). */
export { DOCUMENT_TABS, type DocumentTab };
export const isDocumentTab = (v: string): v is DocumentTab => (DOCUMENT_TABS as readonly string[]).includes(v);

/** The settings' sections, each a route: /app/settings/<section> (the URL is the state). */
export const SETTINGS_SECTIONS = [
  "profil",
  "apparence",
  "securite",
  "facturation",
  "stockage",
  "signets",
  "donnees",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const isSettingsSection = (v: string): v is SettingsSection =>
  (SETTINGS_SECTIONS as readonly string[]).includes(v);

/** A page's `searchParams` as `URLSearchParams` (a repeated key kept, an absent one dropped). */
export const searchOf = (params: Record<string, string | string[] | undefined>): URLSearchParams =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined ? [] : [v].flat().map((x) => [k, x] as [string, string]),
    ),
  );

/** The 308 of an old tab address, its query kept (`/verifications?refused=PAYWALL` → `/rapport?refused=PAYWALL`); null when the tab did not move. */
export function movedDocumentHref(
  locale: "en" | "fr",
  id: string,
  tab: string,
  search: string | URLSearchParams = "",
): string | null {
  const moved = movedDocumentTab(tab);
  if (!moved) return null;
  const qs = new URLSearchParams(search).toString();
  const query = qs ? `?${qs}` : "";
  return `/${locale}/app/documents/${id}/${moved}${query}`;
}
