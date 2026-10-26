import { BATCH_CHECKS, BATCH_COLUMNS, BATCH_ROW_ERROR } from "@yomizaka/core";

import { YOMIZAKA_API_KEY_RULES } from "../api-keys";

/**
 * The OpenAPI 3.1 document of `/api/v1` (yomizaka#202), served at `GET /api/v1/openapi.json`. Built from the code's own data (the
 * scopes, the check words, the row codes), so the document cannot drift from what the routes accept; `openapi.test.ts` also
 * refuses a route without an entry here, and an entry without a route.
 */
const [WRITE, READ, SEAL] = YOMIZAKA_API_KEY_RULES.scopes;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ "application/json": { schema } });
const failure = (description: string) => ({ description, content: json(ref("Error")) });
/** A webhook as OpenAPI 3.1 describes it: what we send. Signed with the endpoint's secret (`x-krizaka-signature`), never a document or a report. */
const webhook = (summary: string, schema: unknown) => ({
  summary,
  parameters: [
    { name: "x-krizaka-signature", in: "header", required: true, schema: { type: "string" }, description: "`t=<unix seconds>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\">` with the endpoint's secret; refuse it when `t` is older than a few minutes." },
    { name: "x-krizaka-event", in: "header", required: true, schema: { type: "string" } },
    { name: "x-krizaka-event-id", in: "header", required: true, schema: { type: "string" }, description: "Stable: a retry carries the same id; apply an event once." },
  ],
  requestBody: { required: true, content: json(schema) },
  responses: { "2XX": { description: "Received. Any other answer is retried after 30 s, 5 min, 30 min, 2 h, 12 h." } },
});
const id = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const secured = (scope: string | undefined) => [{ apiKey: [scope] }];

/** The refusals every route can answer (the key's own, in `lib/api-access.ts`). */
const COMMON = {
  "401": failure("The key is missing, wrong, expired, revoked or replaced (`API_KEY_MISSING`, `API_KEY_INVALID`, `API_KEY_EXPIRED`, `API_KEY_REVOKED`, `API_KEY_SUPERSEDED`)."),
  "403": failure("The key lacks the scope (`API_KEY_SCOPE`), the plan has no API (`API_PLAN`) or the API is switched off (`FEATURE_OFF`)."),
  "429": failure("Past the per-minute limit of the key (`Retry-After` says when)."),
};

export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Yomizaka API",
      version: "1.0.0",
      description:
        "Document checks for landlords and property managers. A check is an Orazaka run; the report is shown as Orazaka returned it (in French). A triage tool, not legal advice.",
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    paths: {
      "/api/v1/checks": {
        post: {
          operationId: "createCheck",
          summary: "Start one check",
          description: "A check is a batch of one row: it takes the same path as a row of a batch (storage, preflight, reuse, entitlement) and answers the same refusals.",
          security: secured(WRITE),
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file", "check"],
                  properties: {
                    file: { type: "string", format: "binary", description: "The document (PDF, Word, OpenDocument text or a photo)." },
                    check: { type: "string", enum: Object.keys(BATCH_CHECKS), description: "The check to run (`compliance`, `authenticity`, or their French words)." },
                    reference: { type: "string", description: "Your own reference, given back as is." },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "The check, started or refused.", content: json({ type: "object", properties: { check: ref("Check") } }) }, "400": failure("`BAD_REQUEST`: the file or the check is missing."), ...COMMON },
        },
      },
      "/api/v1/checks/{id}": {
        get: {
          operationId: "getCheck",
          summary: "Read a check, with its report once it is done",
          description: "Reading advances the check, like opening its page. Poll until `state` is `done`, `failed` or `refused`.",
          security: secured(READ),
          parameters: [id],
          responses: { "200": { description: "The check.", content: json({ type: "object", properties: { check: ref("Check") } }) }, "404": failure("`NOT_FOUND`."), ...COMMON },
        },
      },
      "/api/v1/batches": {
        post: {
          operationId: "createBatch",
          summary: "Start a batch of checks from a CSV",
          security: secured(WRITE),
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["manifest", "files"],
                  properties: {
                    manifest: { type: "string", format: "binary", description: `The CSV; its columns: ${BATCH_COLUMNS.join(", ")} (\`file\` and \`check\` are required).` },
                    files: { type: "array", items: { type: "string", format: "binary" }, description: "The documents the CSV names." },
                    name: { type: "string", description: "The batch's name (default: the CSV's file name)." },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "The batch, its first rows started.", content: json({ type: "object", properties: { batch: ref("Batch") } }) }, "400": failure("`BAD_REQUEST`."), "422": failure("`BATCH_EMPTY`: the CSV has no row."), ...COMMON },
        },
      },
      "/api/v1/batches/{id}": {
        get: {
          operationId: "getBatch",
          summary: "Read a batch, row by row",
          description: "Reading advances the batch up to the account's concurrency. A batch whose pending rows wait for the account says why in `pausedBy`.",
          security: secured(READ),
          parameters: [id],
          responses: { "200": { description: "The batch.", content: json({ type: "object", properties: { batch: ref("Batch") } }) }, "404": failure("`NOT_FOUND`."), ...COMMON },
        },
      },
      "/api/v1/batches/{id}/export": {
        get: {
          operationId: "exportBatch",
          summary: "The reports of a batch in one ZIP",
          description: "`lot.csv` (each row's state, reason and file), `rapports/` (the signed PDF of every compliance row that has a report, in `lang`), `signaux/` (the signals of every authenticity row), `LISEZ-MOI.txt`. A row whose report cannot be issued is listed with its reason. Too heavy an archive is refused (`EXPORT_TOO_LARGE`).",
          security: secured(READ),
          parameters: [id, { name: "lang", in: "query", required: false, schema: { type: "string", enum: ["fr", "en"], default: "fr" } }],
          responses: { "200": { description: "The archive.", content: { "application/zip": { schema: { type: "string", format: "binary" } } } }, "404": failure("`NOT_FOUND`."), "413": failure("`EXPORT_TOO_LARGE`: export fewer rows."), ...COMMON },
        },
      },
      "/api/v1/contracts/seal": {
        post: {
          operationId: "sealContract",
          summary: "Seal a contract",
          description:
            "Renders a contract's content and parties as a PDF and signs it (Ed25519, folios, a visible signature page, the attestation embedded). The same request is the same contract: a retry answers 200 with the first seal. Yomizaka seals — it verifies no identity, no age and no law; `complianceRuleset` is shown as the partner's own statement. The file is kept in the zone of `X-Data-Residency-Zone` (`CA` by default) or the request is refused (`ZONE_UNAVAILABLE`).",
          security: secured(SEAL),
          parameters: [{ name: "x-data-residency-zone", in: "header", required: false, schema: { type: "string", pattern: "^CA(-[A-Z]{2})?$", default: "CA" }, description: "Where the sealed file may be kept: `CA`, or a province like `CA-ON`." }],
          requestBody: { required: true, content: json(ref("SealRequest")) },
          responses: {
            "200": { description: "The seal already made for this request.", content: json(ref("Sealed")) },
            "201": { description: "Sealed.", content: json(ref("Sealed")) },
            "400": failure("`BAD_REQUEST` (with the `fields` that are wrong) or `BAD_ZONE`."),
            "409": failure("`ZONE_UNAVAILABLE`: no store in that zone yet."),
            ...COMMON,
          },
        },
      },
      "/api/v1/contracts/{id}/file": {
        get: {
          operationId: "getSealedContract",
          summary: "The sealed PDF",
          description: "The file as it was sealed, for the account that sealed it. Anyone can check a copy at `/verify/contract/{sha256}` (public: the answer shows no name and no content).",
          security: secured(SEAL),
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^ctr_[0-9a-f]{24}$" } }],
          responses: { "200": { description: "The PDF.", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, "404": failure("`NOT_FOUND`."), ...COMMON },
        },
      },
      "/api/v1/openapi.json": {
        get: { operationId: "getOpenApi", summary: "This document", security: [], responses: { "200": { description: "The OpenAPI 3.1 document.", content: json({ type: "object" }) } } },
      },
    },
    webhooks: {
      "batch.finished": { post: webhook("A batch (or a check) has finished: every row is done, failed or refused.", ref("BatchFinished")) },
      "check.finished": { post: webhook("A check (a batch of one row, started with `POST /api/v1/checks`) has finished.", ref("CheckFinished")) },
    },
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: `\`Authorization: Bearer ${YOMIZAKA_API_KEY_RULES.prefix}_…\`, created in the account (Pro). Scopes: ${YOMIZAKA_API_KEY_RULES.scopes.join(", ")}.` } },
      schemas: {
        SealRequest: {
          type: "object",
          required: ["partnerId", "documentType", "contractPayload", "parties", "complianceRuleset"],
          properties: {
            partnerId: { type: "string", pattern: "^[a-z][a-z0-9-]{1,39}$" },
            documentType: { type: "string", pattern: "^[A-Z][A-Z0-9_]{2,79}$", example: "CREATOR_PARTNERSHIP_CONTRACT" },
            contractPayload: { type: "object", description: "The content to seal (at most 100 000 bytes as canonical JSON)." },
            parties: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: { type: "object", required: ["role", "signedAt"], properties: { role: { type: "string", pattern: "^[A-Z][A-Z0-9_]{1,39}$" }, name: { type: "string" }, userId: { type: "string" }, attestationId: { type: "string" }, signedAt: { type: "string", format: "date-time" } }, description: "At least a `name` or a `userId`." },
            },
            complianceRuleset: { type: "string", description: "The framework the partner says it follows: shown on the seal as the partner's own." },
            locale: { type: "string", enum: ["fr", "en"], default: "fr", description: "The language of the seal's words." },
          },
        },
        Sealed: {
          type: "object",
          properties: {
            success: { const: true },
            contractId: { type: "string" },
            sha256: { type: "string", description: "SHA-256 of the sealed PDF." },
            signedPdfUri: { type: "string", format: "uri" },
            sealedAt: { type: "string", format: "date-time" },
            attestation: { type: "object", properties: { signature: { type: "string" }, publicKey: { type: "string" }, keyId: { type: "string" } } },
          },
        },
        Error: { type: "object", required: ["code", "error"], properties: { code: { type: "string", description: "A stable code; the message is for logs." }, error: { type: "string" } } },
        State: { type: "string", enum: ["pending", "reused", "running", "done", "failed", "refused"] },
        RowError: { type: "string", description: `Why a row did not run: ${Object.values(BATCH_ROW_ERROR).join(", ")} (several, comma-separated, for a refused row), \`PAYWALL\`, \`DAILY_LIMIT\`, \`FAIR_USE\` (the batch waits), \`FAILED\` or \`CANCELLED\` (the run), or the code of the single check that refused it (\`NO_TEXT\`, \`NOT_A_PDF\`…).` },
        BatchFinished: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { const: "batch.finished" },
            payload: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                createdAt: { type: "string", format: "date-time" },
                finishedAt: { type: "string", format: "date-time" },
                counts: { type: "object", additionalProperties: { type: "integer" } },
                rows: { type: "array", items: { type: "object", properties: { line: { type: "integer" }, file: { type: "string" }, reference: { type: ["string", "null"] }, state: ref("State"), error: { type: ["string", "null"] } } } },
              },
            },
          },
        },
        CheckFinished: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { const: "check.finished" },
            payload: { type: "object", properties: { id: { type: "string", format: "uuid" }, state: ref("State"), reference: { type: ["string", "null"] }, error: { type: ["string", "null"] }, finishedAt: { type: "string", format: "date-time" } } },
          },
        },
        Check: {
          type: "object",
          required: ["id", "state", "file", "reference", "error", "documentId", "analysisId", "report", "createdAt", "finishedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            state: ref("State"),
            file: { type: "string" },
            reference: { type: ["string", "null"] },
            error: { oneOf: [ref("RowError"), { type: "null" }], description: "Why it did not run; stable codes." },
            documentId: { type: ["string", "null"], format: "uuid" },
            analysisId: { type: ["string", "null"], format: "uuid" },
            report: { type: ["object", "null"], description: "Orazaka's report (compliance findings, or authenticity signals); only on `GET`, once done. A triage, not legal advice." },
            createdAt: { type: "string", format: "date-time" },
            finishedAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        Batch: {
          type: "object",
          required: ["id", "name", "createdAt", "finishedAt", "items", "counts", "pausedBy"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            finishedAt: { type: ["string", "null"], format: "date-time" },
            counts: { type: "object", additionalProperties: { type: "integer" }, description: "Rows per state." },
            pausedBy: { type: ["string", "null"] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  line: { type: "integer", description: "The row's line in the CSV, header = 1." },
                  file: { type: "string" },
                  reference: { type: ["string", "null"] },
                  state: ref("State"),
                  error: { oneOf: [ref("RowError"), { type: "null" }] },
                  documentId: { type: ["string", "null"] },
                  analysisId: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
    },
  };
}
