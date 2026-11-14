import {
  analysis,
  BATCH_CHECKS,
  BATCH_ITEM_STATES,
  closingNote,
  documentSummary,
  isExtracting,
  type StartAnalysis,
  storageDescriptor,
  waitForExtraction,
  type ExtractionWaitOptions,
  writeBatchManifest,
} from "@verikora/core";
import { z } from "zod";

import { limitsFromConfig, type PreflightLimits } from "./preflight";

/** What the apps give: `createApiClient` of `@krizaka/app-client` fits as is, on a phone and on the Mac. */
export interface ApiPort {
  call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  url(path: string): string;
  authHeaders(): Promise<Record<string, string>>;
}

/** The two moves of the bearer session the API's answers start and end. */
export interface SessionPort {
  saveToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

export type Locale = "fr" | "en";

const accountAnswer = z.object({
  account: z.object({ email: z.string(), locale: z.enum(["fr", "en"]) }),
  token: z.string(),
});
const appConfig = z.object({
  config: z.object({
    maxFileBytes: z.number(),
    allowedTypes: z.array(z.string()),
    features: z.object({ keepDocuments: z.boolean() }).passthrough(),
  }),
});
const uploaded = z.object({ document: documentSummary, duplicate: z.boolean() });
const started = z.object({ analysis, reused: z.boolean().optional() });
const analysisAnswer = z.object({ analysis, closingNote: closingNote.nullable() });
const documentAnswer = z.object({
  document: documentSummary.extend({
    analyses: z.array(analysis),
    storage: storageDescriptor.optional(),
    extractionError: z.string().nullable().optional(),
  }),
});
const tag = z.object({ id: z.string(), name: z.string(), color: z.string() });
const libraries = z.object({
  libraries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      collections: z.array(
        z.object({ id: z.string(), name: z.string(), files: z.number(), folders: z.number(), tags: z.array(tag) }),
      ),
    }),
  ),
  tags: z.array(tag),
});

const me = z.object({
  account: z.object({ email: z.string(), name: z.string().nullable(), avatarSeed: z.string().nullable() }),
});

const batchItem = z.object({
  id: z.string(),
  line: z.number(),
  file: z.string(),
  reference: z.string().nullable(),
  state: z.enum(BATCH_ITEM_STATES),
  error: z.string().nullable(),
  documentId: z.string().nullable(),
  analysisId: z.string().nullable(),
});
const batch = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  items: z.array(batchItem),
  counts: z.record(z.enum(BATCH_ITEM_STATES), z.number()),
  pausedBy: z.string().nullable(),
});
const batchList = z.object({
  batches: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
      items: z.number(),
      done: z.number(),
    }),
  ),
});

/** The check a batch runs on every file, as the manifest names it. */
export type BatchCheck = keyof typeof BATCH_CHECKS;

/**
 * Verikora's API as the apps use it. Every answer is parsed at the edge: a shape the server did not promise stops here,
 * never inside a screen.
 */
export function createVerikoraApi(port: ApiPort, session: SessionPort, wait: ExtractionWaitOptions = {}) {
  const get = <T extends z.ZodType>(schema: T, path: string): Promise<z.infer<T>> =>
    port.call<unknown>(path).then((value) => schema.parse(value));
  return {
    /** The account signs in; its bearer token is kept by `session`. */
    async signIn(email: string, password: string) {
      const answer = accountAnswer.parse(
        await port.call("/api/auth/sign-in", { method: "POST", body: { email, password, client: "native" } }),
      );
      await session.saveToken(answer.token);
      return answer.account;
    },
    async signOut(): Promise<void> {
      await port.call("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
      await session.clearToken();
    },
    /** Who is signed in (`GET /api/me`, verikora#243): what the header's account menu shows. */
    fetchMe: () => get(me, "/api/me").then((r) => r.account),
    /** The limits the web applies, read from the server so the app's pre-flight is the web's. */
    async fetchLimits(): Promise<PreflightLimits> {
      return limitsFromConfig((await get(appConfig, "/api/me/app")).config);
    },
    /**
     * One file as multipart (field `file`): never kept by the server, the document is purged after its check. The server answers
     * 202 Accepted and reads the text after the answer (verikora#21): this resolves when the text is read, so a screen checks
     * what it was handed. A reading that failed rejects with `ExtractionNotReady` (its `reason` is the code to show).
     */
    async uploadDocument(form: FormData) {
      const answer = uploaded.parse(await port.call("/api/documents", { method: "POST", body: form }));
      if (!isExtracting(answer.document.extraction)) return answer;
      const read = await waitForExtraction(
        () => get(documentAnswer, `/api/documents/${answer.document.id}`).then((r) => r.document),
        wait,
      );
      return { ...answer, document: { ...answer.document, ...read, extraction: read.extraction } };
    },
    listDocuments: () =>
      get(z.object({ documents: z.array(documentSummary) }), "/api/documents").then((r) => r.documents),
    async startAnalysis(documentId: string, request: StartAnalysis) {
      return started.parse(await port.call(`/api/documents/${documentId}`, { method: "POST", body: request }));
    },
    fetchAnalysis: (documentId: string, analysisId: string, locale: Locale) =>
      get(analysisAnswer, `/api/documents/${documentId}/analyses/${analysisId}?lang=${locale}`),
    fetchDocument: (documentId: string) => get(documentAnswer, `/api/documents/${documentId}`).then((r) => r.document),
    fetchLibraries: () => get(libraries, "/api/libraries"),
    fetchCollection: (collectionId: string, tags: readonly string[]) => {
      const query = tags.length ? `?tags=${tags.join(",")}` : "";
      return get(z.object({ documents: z.array(documentSummary) }), `/api/collections/${collectionId}${query}`);
    },
    async placeDocument(documentId: string, collectionId: string | null): Promise<void> {
      await port.call(`/api/documents/${documentId}/placement`, { method: "PUT", body: { collectionId } });
    },
    async deleteDocument(documentId: string): Promise<void> {
      await port.call(`/api/documents/${documentId}`, { method: "DELETE" });
    },
    /**
     * A batch (verikora#232): the same check on several files at once — a folder of the Mac, or files dropped on it. The
     * manifest is written here (one row per file); the server stores the files under the workspace's purge and runs the rows.
     */
    async createBatch(name: string, files: readonly { name: string; blob: Blob }[], check: BatchCheck) {
      const form = new FormData();
      form.append("name", name);
      form.append("manifest", writeBatchManifest(files.map((f) => ({ file: f.name, check }))));
      for (const f of files) form.append("files", f.blob, f.name);
      return batch.parse((await port.call<{ batch: unknown }>("/api/batches", { method: "POST", body: form })).batch);
    },
    /** A batch, advanced as it is read: ask again while rows run. */
    fetchBatch: (batchId: string) => get(z.object({ batch }), `/api/batches/${batchId}`).then((r) => r.batch),
    listBatches: () => get(batchList, "/api/batches").then((r) => r.batches),
    /** The signed report, as a PDF: its address and the person's headers, for the download. */
    async reportRequest(documentId: string, analysisId: string, locale: Locale) {
      return {
        url: port.url(`/api/documents/${documentId}/analyses/${analysisId}/report?format=pdf&lang=${locale}`),
        headers: await port.authHeaders(),
      };
    },
  };
}

export type VerikoraApi = ReturnType<typeof createVerikoraApi>;
export type DocumentDetail = Awaited<ReturnType<VerikoraApi["fetchDocument"]>>;
export type Batch = Awaited<ReturnType<VerikoraApi["fetchBatch"]>>;
export type BatchSummary = Awaited<ReturnType<VerikoraApi["listBatches"]>>[number];
