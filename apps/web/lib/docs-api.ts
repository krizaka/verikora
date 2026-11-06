import { openApiDocument } from "./api-v1/openapi";

/**
 * The API reference of /docs, read from the OpenAPI document the app serves (`/api/v1/openapi.json`) at build: nothing about a
 * route is typed by hand here (verikora#387). `openapi.test.ts` already refuses a route missing from the document, so a route
 * missing from the docs is impossible.
 */
export const OPENAPI_PATH = "/api/v1/openapi.json";

export interface ApiAnswer {
  status: string;
  description: string;
}

export interface ApiOperation {
  /** The operationId: the anchor of its section. */
  id: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  /** The key scope it needs; null when no key is needed. */
  scope: string | null;
  /** The path and query parameters, by name. */
  parameters: string[];
  answers: ApiAnswer[];
}

export interface ApiWebhook {
  event: string;
  summary: string;
}

interface RawOperation {
  operationId: string;
  summary: string;
  description?: string;
  security?: Record<string, string[]>[];
  parameters?: { name: string }[];
  responses: Record<string, { description: string }>;
}

// The document is built from a constant origin: the reference does not depend on where it is read.
const spec = (): ReturnType<typeof openApiDocument> => openApiDocument("https://www.verikora.com");

export function apiOperations(): ApiOperation[] {
  return Object.entries(spec().paths).flatMap(([path, methods]) =>
    Object.entries(methods as Record<string, RawOperation>).map(([method, op]) => ({
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      summary: op.summary,
      description: op.description ?? "",
      scope: op.security?.flatMap((requirement) => Object.values(requirement).flat())[0] ?? null,
      parameters: (op.parameters ?? []).map((p) => p.name),
      answers: Object.entries(op.responses).map(([status, answer]) => ({ status, description: answer.description })),
    })),
  );
}

export function apiWebhooks(): ApiWebhook[] {
  return Object.entries(spec().webhooks).map(([event, hook]) => ({ event, summary: hook.post.summary }));
}
