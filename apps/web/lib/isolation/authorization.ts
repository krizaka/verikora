import type { RouteKey } from "./routes";

/**
 * The authorization matrix, as data (krizaka-internal#2382): for every route handler and method of the app, who may call it. The rows
 * are one table; what each caller must get follows from the row (`expectedFor`). `authorization-coverage.test.ts` reads the route
 * tree (`routes.ts`, the list customer isolation reads too) and fails when a handler has no row or a row names no handler;
 * `authorization.integration.test.ts` calls every handler on PostgreSQL as each caller and checks the answer. Test support only:
 * nothing in the app imports this file.
 *
 * What « passes » means: the answer carries none of the gates' refusal codes (`GATE_CODES`). The route may still refuse for its own
 * reason (a 400 for an empty body, a 404 for an id no row has): the gate let the caller in, which is what this matrix proves. Whether
 * the row is the caller's own is customer isolation's (`cases.ts`).
 */

/** Who may call a route. A closed set. */
export const ACCESS = {
  /** anyone: no session is asked; the route's own token, signature or public data is its authority (`why` says which) */
  public: "public",
  /** a signed-in session (`requireSession`): anonymous is 401, a member and an administrator pass, an API key is not a session */
  member: "member",
  /** the administration (`requireAdmin`): a session, the ADMIN role and an address of AUTH_ALLOWED_IPS */
  admin: "admin",
  /** the public API (`apiCaller`): an API key holding the scope; a session is not a key */
  apiKey: "apiKey",
} as const;

/** The scopes an API key can hold (`lib/api-keys/rules.ts`, the coverage test holds the two equal). */
export const API_SCOPES = ["checks:write", "reports:read", "contracts:seal"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type Access =
  | { access: typeof ACCESS.public; why: string }
  | { access: typeof ACCESS.member }
  | { access: typeof ACCESS.admin }
  | { access: typeof ACCESS.apiKey; scope: ApiScope };

/** The callers every row is tried with. */
export const CALLERS = {
  anonymous: "anonymous",
  /** a USER session, from an allowed address (so a refusal is about the role, never the address) */
  member: "member",
  /** an ADMIN session, from an allowed address */
  admin: "admin",
  /** an ADMIN session, from an address outside AUTH_ALLOWED_IPS */
  adminElsewhere: "adminElsewhere",
  /** a member's API key holding the row's scope (all scopes, on a row that takes no key) */
  apiKey: "apiKey",
  /** a member's API key holding every scope but the row's */
  apiKeyWithoutScope: "apiKeyWithoutScope",
} as const;
export type Caller = (typeof CALLERS)[keyof typeof CALLERS];

/** The codes the gates refuse with (`@krizaka/auth`'s admin gate, `requireSession`, `@krizaka/api-keys`). */
export const GATE_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "IP_NOT_ALLOWED",
  "API_KEY_MISSING",
  "API_KEY_INVALID",
  "API_KEY_EXPIRED",
  "API_KEY_REVOKED",
  "API_KEY_SUPERSEDED",
  "API_KEY_SCOPE",
] as const;

export type Expected = { passes: true } | { status: 401 | 403; code: (typeof GATE_CODES)[number] };

const PASSES: Expected = { passes: true };
const NO_SESSION: Expected = { status: 401, code: "UNAUTHENTICATED" };
const NO_KEY: Expected = { status: 401, code: "API_KEY_MISSING" };

/** What a caller must get from a row: the policy, once, for every route. */
export function expectedFor(row: Access, caller: Caller): Expected {
  switch (row.access) {
    case ACCESS.public:
      return PASSES;
    case ACCESS.member:
      // a key sent as a bearer is read as a session token (the native apps' bearer) and is none
      return caller === CALLERS.anonymous || caller === CALLERS.apiKey || caller === CALLERS.apiKeyWithoutScope
        ? NO_SESSION
        : PASSES;
    case ACCESS.admin:
      if (caller === CALLERS.admin) return PASSES;
      if (caller === CALLERS.member) return { status: 403, code: "FORBIDDEN" };
      if (caller === CALLERS.adminElsewhere) return { status: 403, code: "IP_NOT_ALLOWED" };
      return NO_SESSION;
    case ACCESS.apiKey:
      if (caller === CALLERS.apiKey) return PASSES;
      if (caller === CALLERS.apiKeyWithoutScope) return { status: 403, code: "API_KEY_SCOPE" };
      return NO_KEY;
  }
}

const MEMBER: Access = { access: ACCESS.member };
const ADMIN: Access = { access: ACCESS.admin };
const key = (scope: ApiScope): Access => ({ access: ACCESS.apiKey, scope });
const open = (why: string): Access => ({ access: ACCESS.public, why });

/** Every route handler and method, and who may call it. A new handler fails the coverage test until it has its row here. */
export const AUTHORIZATION: Record<RouteKey, Access> = {
  "POST /api/admin/analyses/[id]/showcase": ADMIN,
  "DELETE /api/admin/analyses/[id]/showcase": ADMIN,
  "GET /api/admin/compliance-gate": ADMIN,
  "PUT /api/admin/compliance-gate": ADMIN,
  "GET /api/admin/coupons": ADMIN,
  "POST /api/admin/coupons": ADMIN,
  "GET /api/admin/coupons/[id]": ADMIN,
  "POST /api/admin/coupons/[id]": ADMIN,
  "PATCH /api/admin/coupons/[id]": ADMIN,
  "GET /api/admin/coupons/code": ADMIN,
  "GET /api/admin/coupons/partners": ADMIN,
  "POST /api/admin/coupons/partners": ADMIN,
  "GET /api/admin/coupons/partners/[id]": ADMIN,
  "POST /api/admin/coupons/partners/[id]": ADMIN,
  "GET /api/admin/coupons/pilot-counters": ADMIN,
  "POST /api/admin/documents/[id]/sample": ADMIN,
  "DELETE /api/admin/documents/[id]/sample": ADMIN,
  "GET /api/admin/flows": ADMIN,
  "POST /api/admin/flows": ADMIN,
  "PUT /api/admin/flows/[id]/draft": ADMIN,
  "PUT /api/admin/flows/[id]/environments": ADMIN,
  "POST /api/admin/flows/[id]/publish": ADMIN,
  "GET /api/admin/incidents": ADMIN,
  "POST /api/admin/incidents": ADMIN,
  "POST /api/admin/incidents/[id]": ADMIN,
  "GET /api/admin/incidents/export": ADMIN,
  "GET /api/admin/invitations": ADMIN,
  "POST /api/admin/invitations": ADMIN,
  "POST /api/admin/invitations/[id]": ADMIN,
  "GET /api/admin/organize/[kind]/config": ADMIN,
  "PUT /api/admin/organize/[kind]/config": ADMIN,
  "GET /api/admin/preflight": ADMIN,
  "GET /api/admin/prices": ADMIN,
  "POST /api/admin/prices": ADMIN,
  "POST /api/admin/prices/sync": ADMIN,
  "GET /api/admin/refused-words": ADMIN,
  "POST /api/admin/refused-words": ADMIN,
  "DELETE /api/admin/refused-words": ADMIN,
  "GET /api/admin/settings": ADMIN,
  "PUT /api/admin/settings": ADMIN,
  "DELETE /api/admin/settings": ADMIN,
  "GET /api/admin/settings/audit": ADMIN,
  "GET /api/admin/sovkora": ADMIN,
  "POST /api/admin/sovkora/test": ADMIN,
  "GET /api/admin/storage": ADMIN,
  "POST /api/admin/storage": ADMIN,
  "DELETE /api/admin/storage/[id]": ADMIN,
  "POST /api/admin/storage/[id]/default": ADMIN,
  "PUT /api/admin/storage/[id]/key": ADMIN,
  "POST /api/admin/storage/[id]/retire": ADMIN,
  "POST /api/admin/storage/[id]/test": ADMIN,
  "POST /api/admin/storage/move": ADMIN,
  "POST /api/admin/storage/move/pause": ADMIN,
  "POST /api/admin/storage/move/resume": ADMIN,
  "GET /api/admin/users": ADMIN,
  "DELETE /api/admin/users/[id]": ADMIN,
  "GET /api/admin/users/[id]/export": ADMIN,
  "POST /api/admin/users/[id]/plan": ADMIN,
  "POST /api/admin/users/[id]/restore": ADMIN,
  "POST /api/admin/users/[id]/role": ADMIN,
  "DELETE /api/admin/users/[id]/sessions": ADMIN,
  "POST /api/admin/users/[id]/suspend": ADMIN,
  "GET /api/app-config": open("the apps' configuration contract (@krizaka/app-config): read before anyone signs in"),
  "POST /api/applicant": open(
    "the applicant's answer: the invitation token it carries is the authority, the applicant has no account",
  ),
  "POST /api/applicant/documents": open(
    "the applicant's upload: the invitation token it carries is the authority, the applicant has no account",
  ),
  "GET /api/applications": MEMBER,
  "POST /api/applications": MEMBER,
  "GET /api/applications/[id]": MEMBER,
  "POST /api/applications/[id]": MEMBER,
  "GET /api/applications/[id]/report-shares": MEMBER,
  "POST /api/applications/[id]/report-shares": MEMBER,
  "DELETE /api/applications/[id]/report-shares": MEMBER,
  "POST /api/applications/[id]/report-shares/send": MEMBER,
  "POST /api/auth/confirm-email": open(
    "the mailed single-use link: its keyed token is the authority, before any session exists",
  ),
  "POST /api/auth/forgot-password": open("asked by someone who cannot sign in; it answers the same for any address"),
  "POST /api/auth/reset-password": open("the mailed reset token is the authority; the person cannot sign in"),
  "POST /api/auth/sign-in": open("opens the session: the e-mail and password are its authority"),
  "POST /api/auth/sign-out": open("revokes the session the request carries; without one there is nothing to revoke"),
  "POST /api/auth/sign-up": open("creates the account; closed server-side unless the `signup.open` setting is on"),
  "GET /api/auth/sign-up/status": open("says whether sign-up is open, to the page that offers it"),
  "POST /api/auth/verify-email": open(
    "the mailed single-use link: its keyed token is the authority, before any session exists",
  ),
  "GET /api/batches": MEMBER,
  "POST /api/batches": MEMBER,
  "GET /api/batches/[id]": MEMBER,
  "GET /api/batches/[id]/export": MEMBER,
  "POST /api/batches/preview": MEMBER,
  "GET /api/batches/template": open("a static CSV template with fictitious example rows, no customer data"),
  "GET /api/billing": MEMBER,
  "POST /api/billing/checkout": MEMBER,
  "POST /api/billing/coupon": MEMBER,
  "POST /api/billing/coupon/redeem": MEMBER,
  "GET /api/billing/payments": MEMBER,
  "POST /api/billing/portal": MEMBER,
  "POST /api/collections": MEMBER,
  "GET /api/collections/[id]": MEMBER,
  "PATCH /api/collections/[id]": MEMBER,
  "DELETE /api/collections/[id]": MEMBER,
  "GET /api/collections/[id]/avatar": MEMBER,
  "POST /api/collections/[id]/avatar": MEMBER,
  "DELETE /api/collections/[id]/avatar": MEMBER,
  "POST /api/consents": MEMBER,
  "DELETE /api/consents": MEMBER,
  "GET /api/documents": MEMBER,
  "POST /api/documents": MEMBER,
  "GET /api/documents/[id]": MEMBER,
  "POST /api/documents/[id]": MEMBER,
  "DELETE /api/documents/[id]": MEMBER,
  "GET /api/documents/[id]/analyses/[analysisId]": MEMBER,
  "GET /api/documents/[id]/analyses/[analysisId]/grants": MEMBER,
  "POST /api/documents/[id]/analyses/[analysisId]/grants": MEMBER,
  "DELETE /api/documents/[id]/analyses/[analysisId]/grants/[grantId]": MEMBER,
  "GET /api/documents/[id]/analyses/[analysisId]/report": MEMBER,
  "GET /api/documents/[id]/bundle": MEMBER,
  "POST /api/documents/[id]/bundle": MEMBER,
  "DELETE /api/documents/[id]/bundle": MEMBER,
  "GET /api/documents/[id]/file": MEMBER,
  "PUT /api/documents/[id]/placement": MEMBER,
  "GET /api/documents/[id]/receipt": MEMBER,
  "GET /api/documents/[id]/redacted": MEMBER,
  "GET /api/flows": MEMBER,
  "POST /api/folders": MEMBER,
  "PATCH /api/folders/[id]": MEMBER,
  "DELETE /api/folders/[id]": MEMBER,
  "GET /api/healthz": open("the platform's health probe, no data"),
  "GET /api/libraries": MEMBER,
  "POST /api/libraries": MEMBER,
  "PATCH /api/libraries/[id]": MEMBER,
  "DELETE /api/libraries/[id]": MEMBER,
  "GET /api/me": open(
    "the family's contract: answers `{ signedIn: false }` to anonymous, the account only to its session",
  ),
  "GET /api/me/api-keys": MEMBER,
  "POST /api/me/api-keys": MEMBER,
  "DELETE /api/me/api-keys/[id]": MEMBER,
  "POST /api/me/api-keys/[id]/rotate": MEMBER,
  "GET /api/me/app": MEMBER,
  "POST /api/me/delete": MEMBER,
  "POST /api/me/email": MEMBER,
  "GET /api/me/export": MEMBER,
  "PUT /api/me/password": MEMBER,
  "GET /api/me/perspective": MEMBER,
  "PUT /api/me/perspective": MEMBER,
  "GET /api/me/profile": MEMBER,
  "PATCH /api/me/profile": MEMBER,
  "GET /api/me/storage": MEMBER,
  "PUT /api/me/storage": MEMBER,
  "POST /api/me/storage/cloud/[cloud]": MEMBER,
  "GET /api/me/storage/cloud/callback": MEMBER,
  "POST /api/me/storage/cloud/disconnect": MEMBER,
  "POST /api/me/storage/test": MEMBER,
  "GET /api/me/territory": MEMBER,
  "PUT /api/me/territory": MEMBER,
  "GET /api/me/webhooks": MEMBER,
  "POST /api/me/webhooks": MEMBER,
  "PATCH /api/me/webhooks/[id]": MEMBER,
  "DELETE /api/me/webhooks/[id]": MEMBER,
  "GET /api/me/webhooks/[id]/deliveries": MEMBER,
  "POST /api/me/webhooks/[id]/rotate": MEMBER,
  "GET /api/organize/[kind]/config": MEMBER,
  "POST /api/organize/[kind]/status": MEMBER,
  "GET /api/organize/[kind]/tags": MEMBER,
  "POST /api/organize/[kind]/tags": MEMBER,
  "PATCH /api/organize/[kind]/tags/[id]": MEMBER,
  "DELETE /api/organize/[kind]/tags/[id]": MEMBER,
  "POST /api/organize/[kind]/tags/apply": MEMBER,
  "PUT /api/organize/[kind]/tags/set": MEMBER,
  "GET /api/organize/[kind]/views": MEMBER,
  "POST /api/organize/[kind]/views": MEMBER,
  "PATCH /api/organize/[kind]/views/[id]": MEMBER,
  "DELETE /api/organize/[kind]/views/[id]": MEMBER,
  "GET /api/rapport/[token]/pdf": open("the owner report's share link: the signed token in the path is the authority"),
  "GET /api/screenings": MEMBER,
  "POST /api/screenings": MEMBER,
  "POST /api/screenings/respond": open(
    "the screened person's answer: the token it carries is the authority, they have no account",
  ),
  "GET /api/search": MEMBER,
  "GET /api/showcase": open("the home's public sample, promoted by an administrator; a fictitious document"),
  "GET /api/showcase/file": open(
    "the file of the home's public sample, promoted by an administrator; a fictitious document",
  ),
  "GET /api/tags": MEMBER,
  "POST /api/tags": MEMBER,
  "PATCH /api/tags/[id]": MEMBER,
  "DELETE /api/tags/[id]": MEMBER,
  "PUT /api/tags/assign": MEMBER,
  "POST /api/v1/batches": key("checks:write"),
  "GET /api/v1/batches/[id]": key("reports:read"),
  "GET /api/v1/batches/[id]/export": key("reports:read"),
  "POST /api/v1/checks": key("checks:write"),
  "GET /api/v1/checks/[id]": key("reports:read"),
  "GET /api/v1/contracts/[id]/file": key("contracts:seal"),
  "POST /api/v1/contracts/seal": key("contracts:seal"),
  "GET /api/v1/openapi.json": open("the public API's description"),
  "POST /api/verify": MEMBER,
  "GET /api/verify/contract/[sha256]": open(
    "public verification of a sealed contract: who sealed it and when, never a name or the content",
  ),
  "POST /api/verify/request-access": MEMBER,
  "POST /api/webhooks/mail": open("the mail provider's callback, signed with MAIL_WEBHOOK_SIGNING_KEY"),
  "POST /api/webhooks/payments": open("the payment processor's callback, signed with its webhook secret"),
};

/** Who may open a page. A closed set; the layouts hold the locks (`page-access.test.ts`). */
export const PAGE_ACCESS = {
  public: "public",
  /** the signed-in space, `(app)/app/layout.tsx`: no session → the sign-in page */
  member: "member",
  /** the administration, `(admin)/console/(signed)/layout.tsx`: no session → sign-in; a member or a foreign address → 404 */
  admin: "admin",
} as const;
export type PageAccess = (typeof PAGE_ACCESS)[keyof typeof PAGE_ACCESS];

/** The folder under `app/` that holds each lock: a page's row must agree with the folder it lives in. */
export const PAGE_LOCK_FOLDER: Record<Exclude<PageAccess, "public">, string> = {
  member: "[locale]/(app)/app",
  admin: "[locale]/(admin)/console/(signed)",
};

const P = PAGE_ACCESS.public;
const M = PAGE_ACCESS.member;
const A = PAGE_ACCESS.admin;

/** Every page (its folder under `app/`), and who may open it. */
export const PAGES_ACCESS: Record<string, PageAccess> = {
  "[locale]": P,
  "[locale]/(admin)/console/(signed)": A,
  "[locale]/(admin)/console/(signed)/audit": A,
  "[locale]/(admin)/console/(signed)/config": A,
  "[locale]/(admin)/console/(signed)/config/[group]": A,
  "[locale]/(admin)/console/(signed)/documents": A,
  "[locale]/(admin)/console/(signed)/flows": A,
  "[locale]/(admin)/console/(signed)/flows/[id]": A,
  "[locale]/(admin)/console/(signed)/flows/new": A,
  "[locale]/(admin)/console/(signed)/incidents": A,
  "[locale]/(admin)/console/(signed)/operations": A,
  "[locale]/(admin)/console/(signed)/runs": A,
  "[locale]/(admin)/console/(signed)/storage": A,
  "[locale]/(admin)/console/(signed)/users": A,
  "[locale]/(admin)/console/(signed)/users/[id]": A,
  "[locale]/(admin)/console/sign-in": P,
  "[locale]/(app)/app": M,
  "[locale]/(app)/app/check": M,
  "[locale]/(app)/app/check/batches": M,
  "[locale]/(app)/app/check/batches/[id]": M,
  "[locale]/(app)/app/documents": M,
  "[locale]/(app)/app/documents/[id]": M,
  "[locale]/(app)/app/documents/[id]/[tab]": M,
  "[locale]/(app)/app/dossiers": M,
  "[locale]/(app)/app/dossiers/[id]": M,
  "[locale]/(app)/app/library/[library]": M,
  "[locale]/(app)/app/library/[library]/[collection]": M,
  "[locale]/(app)/app/library/[library]/[collection]/[folder]": M,
  "[locale]/(app)/app/plans": M,
  "[locale]/(app)/app/screening": M,
  "[locale]/(app)/app/search": M,
  "[locale]/(app)/app/settings": M,
  "[locale]/(app)/app/settings/[section]": M,
  "[locale]/(app)/app/verifications": M,
  "[locale]/(app)/app/verifications/report": M,
  "[locale]/(app)/app/welcome": M,
  "[locale]/(app)/forgot-password": P,
  "[locale]/(app)/reset-password": P,
  "[locale]/(app)/sign-in": P,
  "[locale]/(app)/sign-up": P,
  "[locale]/[...rest]": P,
  "[locale]/confirm-email": P,
  "[locale]/contact": P,
  "[locale]/docs": P,
  "[locale]/dossier/[token]": P,
  "[locale]/download": P,
  "[locale]/pricing": P,
  "[locale]/privacy": P,
  "[locale]/rapport/[token]": P,
  "[locale]/screening/[token]": P,
  "[locale]/terms": P,
  "[locale]/verify-email": P,
};
