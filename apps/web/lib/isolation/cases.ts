import type { RouteKey } from "./routes";

/**
 * Customer isolation, as data (krizaka-internal#2383): for every route that takes the id of a customer's row, what customer B sends
 * when B tries customer A's id. `route-coverage.test.ts` reads the route tree and fails when a route that takes an id has no entry
 * here; `customer-isolation.integration.test.ts` runs every entry against PostgreSQL with two seeded customers.
 *
 * The rule each case proves (`lib/http` `refuse(404, …)` in every owner-scoped loader): B asking for A's id gets the answer B gets for
 * an id that does not exist — the same status and the same code, a 404 — so B learns neither the row nor that it exists. A list B
 * reads never holds one of A's ids. Test support only: nothing in the app imports this file.
 */

/** A's rows, by aggregate. B's attempts use these; the « absent » control replaces each with an id no row has. */
export interface TheirIds {
  /** upload */
  document: string;
  /** report */
  analysis: string;
  grant: string;
  /** dossier (applicant file, a `screenings` row) */
  application: string;
  /** a batch of several lines, and a one-line batch the API calls a check */
  batch: string;
  check: string;
  /** a sealed contract (`ctr_` + 24 hex) */
  contract: string;
  library: string;
  /** the library that holds A's default collection */
  homeLibrary: string;
  collection: string;
  folder: string;
  tag: string;
  /** the workspace's tag and saved view (`organize` schema) */
  organizeTag: string;
  view: string;
  apiKey: string;
  webhook: string;
}

/** B's own rows, for the attempts that put A's id in the body of a request on B's own row. */
export interface OwnIds {
  document: string;
  collection: string;
  organizeTag: string;
}

export interface Ask {
  params: Record<string, string>;
  /** a JSON body */
  body?: unknown;
  /** a multipart body */
  form?: () => FormData;
  /** the query string, with its « ? » */
  search?: string;
}

export interface IsolationCase {
  /** a signed-in session, or an API key (`/api/v1`) */
  auth: "session" | "apiKey";
  /** A reading their own row must succeed: proves the 404 B gets is about ownership, not a broken seed. Reads only. */
  ownerRead?: true;
  ask: (their: TheirIds, own: OwnIds) => Ask;
  /** What B must get (default 404). Another status is stated with the code's rule. */
  status?: number;
}

/** `METHOD /api/path/[param]`: the one key of the route table (`routes.ts`). */
export type { RouteKey } from "./routes";

const doc = (t: TheirIds) => ({ id: t.document });
const report = (t: TheirIds) => ({ id: t.document, analysisId: t.analysis });
const dossier = (t: TheirIds) => ({ id: t.application });
const KIND = "applicant_file";
/** A fresh file each call (a duplicate would answer before the placement is read). */
const textFile = (name: string) =>
  new File([new TextEncoder().encode(`Bail fictif ${name} ${crypto.randomUUID()}.`)], `${name}.txt`, {
    type: "text/plain",
  });

/** Every route that takes one of A's ids, in the path or in the body, and B's attempt at it. */
export const CASES: Record<RouteKey, IsolationCase[]> = {
  // upload
  "GET /api/documents/[id]": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: doc(t) }) }],
  "POST /api/documents/[id]": [
    {
      auth: "session",
      ask: (t) => ({ params: doc(t), body: { studio: "compliance-check", jurisdiction: "QC" } }),
    },
  ],
  "DELETE /api/documents/[id]": [{ auth: "session", ask: (t) => ({ params: doc(t) }) }],
  "GET /api/documents/[id]/file": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: doc(t) }) }],
  "GET /api/documents/[id]/redacted": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: doc(t) }) }],
  "GET /api/documents/[id]/receipt": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: doc(t) }) }],
  "GET /api/documents/[id]/bundle": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: doc(t) }) }],
  "POST /api/documents/[id]/bundle": [
    { auth: "session", ask: (t, o) => ({ params: doc(t), body: { documentId: o.document, role: "annex" } }) },
    // B attaches A's document to B's own lease
    {
      auth: "session",
      ask: (t, o) => ({ params: { id: o.document }, body: { documentId: t.document, role: "annex" } }),
    },
  ],
  "DELETE /api/documents/[id]/bundle": [
    { auth: "session", ask: (t, o) => ({ params: doc(t), body: { documentId: o.document } }) },
  ],
  "PUT /api/documents/[id]/placement": [
    { auth: "session", ask: (t, o) => ({ params: doc(t), body: { collectionId: o.collection } }) },
    // B moves B's own document into A's collection
    { auth: "session", ask: (t, o) => ({ params: { id: o.document }, body: { collectionId: t.collection } }) },
  ],
  // B uploads into A's collection
  "POST /api/documents": [
    {
      auth: "session",
      ask: (t) => ({
        params: {},
        form: () => {
          const form = new FormData();
          form.set("file", textFile("isolation-upload"));
          form.set("collectionId", t.collection);
          return form;
        },
      }),
    },
  ],

  // report
  "GET /api/documents/[id]/analyses/[analysisId]": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: report(t) }) },
  ],
  "GET /api/documents/[id]/analyses/[analysisId]/report": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: report(t) }) },
    { auth: "session", ownerRead: true, ask: (t) => ({ params: report(t), search: "?format=pdf" }) },
  ],
  "GET /api/documents/[id]/analyses/[analysisId]/grants": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: report(t) }) },
  ],
  "POST /api/documents/[id]/analyses/[analysisId]/grants": [
    { auth: "session", ask: (t) => ({ params: report(t), body: { email: "tiers@exemple.test" } }) },
  ],
  "DELETE /api/documents/[id]/analyses/[analysisId]/grants/[grantId]": [
    { auth: "session", ask: (t) => ({ params: { ...report(t), grantId: t.grant } }) },
  ],

  // dossier
  "GET /api/applications/[id]": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: dossier(t) }) }],
  "POST /api/applications/[id]": [
    { auth: "session", ask: (t) => ({ params: dossier(t), body: { action: "revoke" } }) },
    { auth: "session", ask: (t) => ({ params: dossier(t), body: { action: "close" } }) },
  ],
  "GET /api/applications/[id]/report-shares": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: dossier(t) }) },
  ],
  "POST /api/applications/[id]/report-shares": [{ auth: "session", ask: (t) => ({ params: dossier(t), body: {} }) }],
  "DELETE /api/applications/[id]/report-shares": [
    { auth: "session", ask: (t) => ({ params: dossier(t), body: { shareId: t.grant } }) },
  ],
  "POST /api/applications/[id]/report-shares/send": [
    {
      auth: "session",
      ask: (t) => ({ params: dossier(t), body: { token: "x", email: "proprio@exemple.test", locale: "fr" } }),
    },
  ],
  "POST /api/organize/[kind]/status": [
    { auth: "session", ask: (t) => ({ params: { kind: KIND }, body: { ids: [t.application], to: "retenu" } }) },
  ],
  "POST /api/organize/[kind]/tags/apply": [
    // B puts B's own tag on A's file
    {
      auth: "session",
      ask: (t, o) => ({ params: { kind: KIND }, body: { ids: [t.application], add: [o.organizeTag] } }),
    },
  ],
  "PUT /api/organize/[kind]/tags/set": [
    {
      auth: "session",
      ask: (t, o) => ({ params: { kind: KIND }, body: { id: t.application, tagIds: [o.organizeTag] } }),
    },
  ],
  "PATCH /api/organize/[kind]/tags/[id]": [
    { auth: "session", ask: (t) => ({ params: { kind: KIND, id: t.organizeTag }, body: { name: "pris" } }) },
  ],
  "DELETE /api/organize/[kind]/tags/[id]": [
    { auth: "session", ask: (t) => ({ params: { kind: KIND, id: t.organizeTag } }) },
  ],
  "PATCH /api/organize/[kind]/views/[id]": [
    { auth: "session", ask: (t) => ({ params: { kind: KIND, id: t.view }, body: { name: "prise" } }) },
  ],
  "DELETE /api/organize/[kind]/views/[id]": [{ auth: "session", ask: (t) => ({ params: { kind: KIND, id: t.view } }) }],

  // batches (and the API's checks: a one-line batch)
  "GET /api/batches/[id]": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: { id: t.batch } }) }],
  "GET /api/batches/[id]/export": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: { id: t.batch } }) },
    { auth: "session", ownerRead: true, ask: (t) => ({ params: { id: t.batch }, search: "?format=zip" }) },
  ],
  "GET /api/v1/batches/[id]": [{ auth: "apiKey", ownerRead: true, ask: (t) => ({ params: { id: t.batch } }) }],
  "GET /api/v1/batches/[id]/export": [{ auth: "apiKey", ownerRead: true, ask: (t) => ({ params: { id: t.batch } }) }],
  "GET /api/v1/checks/[id]": [{ auth: "apiKey", ownerRead: true, ask: (t) => ({ params: { id: t.check } }) }],
  "GET /api/v1/contracts/[id]/file": [
    { auth: "apiKey", ownerRead: true, ask: (t) => ({ params: { id: t.contract } }) },
  ],

  // the library: libraries, collections, folders, tags
  "PATCH /api/libraries/[id]": [
    { auth: "session", ask: (t) => ({ params: { id: t.library }, body: { name: "pris" } }) },
  ],
  "DELETE /api/libraries/[id]": [
    // A's library holds a collection; was 409 NOT_EMPTY for A's id and 404 for an absent one (fixed in deleteLibrary)
    { auth: "session", ask: (t) => ({ params: { id: t.library } }) },
    // A's library holds the default collection; was 409 DEFAULT_COLLECTION the same way
    { auth: "session", ask: (t) => ({ params: { id: t.homeLibrary } }) },
  ],
  "POST /api/collections": [
    { auth: "session", ask: (t) => ({ params: {}, body: { libraryId: t.library, name: "intrus" } }) },
  ],
  "GET /api/collections/[id]": [{ auth: "session", ownerRead: true, ask: (t) => ({ params: { id: t.collection } }) }],
  "PATCH /api/collections/[id]": [
    { auth: "session", ask: (t) => ({ params: { id: t.collection }, body: { name: "prise" } }) },
  ],
  "DELETE /api/collections/[id]": [
    { auth: "session", ask: (t) => ({ params: { id: t.collection }, body: { files: "delete" } }) },
  ],
  "GET /api/collections/[id]/avatar": [
    // A's collection has no stored image: A gets a 404 too, so this case only compares B's answer with an absent id
    { auth: "session", ask: (t) => ({ params: { id: t.collection } }) },
  ],
  "POST /api/collections/[id]/avatar": [
    {
      // A deployment without an avatar store refuses before any row is read (503 AVATAR_STORAGE_OFF), for any id alike: the test
      // database has none. With one, the upload's owner check (uploadAvatar) answers 404.
      status: 503,
      auth: "session",
      ask: (t) => ({
        params: { id: t.collection },
        form: () => {
          const form = new FormData();
          form.set("file", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" }));
          return form;
        },
      }),
    },
  ],
  "DELETE /api/collections/[id]/avatar": [{ auth: "session", ask: (t) => ({ params: { id: t.collection } }) }],
  "POST /api/folders": [
    { auth: "session", ask: (t) => ({ params: {}, body: { collectionId: t.collection, name: "intrus" } }) },
  ],
  "PATCH /api/folders/[id]": [{ auth: "session", ask: (t) => ({ params: { id: t.folder }, body: { name: "pris" } }) }],
  "DELETE /api/folders/[id]": [
    { auth: "session", ask: (t) => ({ params: { id: t.folder }, body: { files: "delete" } }) },
  ],
  "PATCH /api/tags/[id]": [{ auth: "session", ask: (t) => ({ params: { id: t.tag }, body: { name: "pris" } }) }],
  "DELETE /api/tags/[id]": [{ auth: "session", ask: (t) => ({ params: { id: t.tag } }) }],
  "PUT /api/tags/assign": [
    // A's tag on B's collection, and B's tags on A's collection
    {
      auth: "session",
      ask: (t, o) => ({ params: {}, body: { kind: "collection", id: o.collection, tagIds: [t.tag] } }),
    },
    { auth: "session", ask: (t) => ({ params: {}, body: { kind: "collection", id: t.collection, tagIds: [] } }) },
  ],

  // the account's keys and endpoints
  "DELETE /api/me/api-keys/[id]": [{ auth: "session", ask: (t) => ({ params: { id: t.apiKey } }) }],
  "POST /api/me/api-keys/[id]/rotate": [{ auth: "session", ask: (t) => ({ params: { id: t.apiKey } }) }],
  "PATCH /api/me/webhooks/[id]": [
    { auth: "session", ask: (t) => ({ params: { id: t.webhook }, body: { active: false } }) },
  ],
  "DELETE /api/me/webhooks/[id]": [{ auth: "session", ask: (t) => ({ params: { id: t.webhook } }) }],
  "POST /api/me/webhooks/[id]/rotate": [{ auth: "session", ask: (t) => ({ params: { id: t.webhook } }) }],
  "GET /api/me/webhooks/[id]/deliveries": [
    { auth: "session", ownerRead: true, ask: (t) => ({ params: { id: t.webhook } }) },
  ],
};

/** The lists B reads: none may hold one of A's ids. `shows` is the id A's own list holds (the control). */
export const LISTS: Record<
  RouteKey,
  { auth: "session" | "apiKey"; search?: string; params?: Record<string, string>; shows: keyof TheirIds | null }
> = {
  "GET /api/documents": { auth: "session", shows: "document" },
  "GET /api/applications": { auth: "session", shows: "application" },
  "GET /api/batches": { auth: "session", shows: "batch" },
  "GET /api/libraries": { auth: "session", shows: "library" },
  "GET /api/tags": { auth: "session", shows: "tag" },
  "GET /api/search": { auth: "session", search: "?q=isolation", shows: null },
  "GET /api/screenings": { auth: "session", shows: null },
  "GET /api/me/api-keys": { auth: "session", shows: "apiKey" },
  "GET /api/me/webhooks": { auth: "session", shows: "webhook" },
  "GET /api/me/export": { auth: "session", shows: "document" },
  "GET /api/billing": { auth: "session", shows: null },
  "GET /api/billing/payments": { auth: "session", shows: null },
  "GET /api/organize/[kind]/tags": { auth: "session", params: { kind: KIND }, shows: "organizeTag" },
  "GET /api/organize/[kind]/views": { auth: "session", params: { kind: KIND }, shows: "view" },
};

/**
 * The routes that take an id but are not a customer's door to another customer's row, each with the rule that makes it so. The guard
 * accepts a route here only with its reason; a new route lands in none of the three tables until someone writes its case or its reason.
 */
export const NOT_OWNER_SCOPED: Record<string, string> = {
  "/api/admin/":
    "the administration: ADMIN role and an allowed address (lib/access requireAdmin), reads every account by design",
  "/api/rapport/[token]/pdf":
    "a share link: the token is the capability the owner sent (owner-report-shares), no session is read; an unknown token is 404",
  "/api/verify/contract/[sha256]":
    "public by design (AGENTS.md § 4 sealed contracts): shows who sealed and when, never a name, an account or the content",
  "/api/me/storage/cloud/[cloud]":
    "the segment is a provider name (isCloudName), not a row: it starts the caller's own connection",
  "GET /api/organize/[kind]/config":
    "the segment is a kind; the configuration is the product's, the same for every account",
  "POST /api/organize/[kind]/tags": "creates in the caller's own space; the list it feeds is in LISTS",
  "POST /api/organize/[kind]/views": "creates in the caller's own space; the list it feeds is in LISTS",
  "/api/applicant":
    "the applicant's side: the screening token is the capability the manager sent, the documentId is the applicant's own upload",
  "/api/verify/request-access":
    "answers the same 202 whether the report exists or not (its comment: « a stranger learns nothing »); the owner decides",
};

/** The console pages that take an id, and the case that runs the loader they share with the API (same function, same owner check). */
export const PAGES: Record<string, RouteKey | string> = {
  "[locale]/(app)/app/documents/[id]": "redirect to the document's default tab: see documents/[id]/[tab]",
  "[locale]/(app)/app/documents/[id]/[tab]": "GET /api/documents/[id]",
  "[locale]/(app)/app/dossiers/[id]": "GET /api/applications/[id]",
  "[locale]/(app)/app/check/batches/[id]": "GET /api/batches/[id]",
  "[locale]/(app)/app/library/[library]": "redirects to the library page: it reads no row",
  "[locale]/(app)/app/library/[library]/[collection]": "GET /api/collections/[id]",
  "[locale]/(app)/app/library/[library]/[collection]/[folder]": "GET /api/collections/[id]",
  "[locale]/(app)/app/settings/[section]": "the segment is a settings section, not a row",
  "[locale]/(admin)/console/(signed)/config/[group]": "the administration (admin host, ADMIN role, allowed address)",
  "[locale]/(admin)/console/(signed)/flows/[id]": "the administration (admin host, ADMIN role, allowed address)",
  "[locale]/(admin)/console/(signed)/users/[id]": "the administration (admin host, ADMIN role, allowed address)",
  "[locale]/rapport/[token]": "a share link: see /api/rapport/[token]/pdf",
  "[locale]/screening/[token]": "the applicant's link: the token is the capability",
  "[locale]/dossier/[token]": "the applicant's link: the token is the capability",
};
