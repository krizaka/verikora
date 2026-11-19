import { randomUUID } from "node:crypto";

import { logError, logWarn } from "./log";

/** An error the API answers with: a status, a stable code (the client translates it), a message for logs. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** A text field of a multipart form: the string it holds, or "" when it is absent or is a file. */
export const fieldText = (form: FormData | null, name: string): string => {
  const value = form?.get(name);
  return typeof value === "string" ? value : "";
};

/** The stable code an HttpError answers with, or the fallback when its body names none. */
export const codeOf = (error: HttpError, fallback: string): string =>
  typeof error.body.code === "string" ? error.body.code : fallback;

export const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpError(status, message, { code, ...extra });

/** The id a request is followed by in the logs and in its error: the proxy's own when it sent one, else a fresh one. */
export const requestIdOf = (req: Request): string => {
  const sent = req.headers.get("x-request-id") ?? "";
  return /^[\w.-]{8,64}$/.test(sent) ? sent : randomUUID();
};

/** The refusal of a request that has an id, in the log: the line a person quotes the id against. */
function logRefusal(requestId: string | null, error: HttpError, code: string): void {
  if (requestId) {
    logWarn(`api: request ${requestId} refused ${error.status} ${code}: ${error.message}`);
  }
}

/** Runs a route handler: an HttpError becomes its JSON answer; anything else is a 500 that leaks nothing. With the request, every error carries its request id (body, header and log line). */
export async function handle(run: () => Promise<Response>, req?: Request): Promise<Response> {
  const requestId = req ? requestIdOf(req) : null;
  const ids = requestId ? { requestId } : {};
  const idHeader: Record<string, string> = requestId ? { "X-Request-Id": requestId } : {};
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) {
      // The code also rides in a header: the DigitalOcean ingress replaces a 502's body with its own page and keeps the headers (krizaka-internal#3214).
      const code = codeOf(error, "");
      logRefusal(requestId, error, code);
      return Response.json(
        { error: error.message, ...error.body, ...ids },
        { status: error.status, headers: { ...error.headers, ...idHeader, ...(code ? { "X-Error-Code": code } : {}) } },
      );
    }
    logError(requestId ? `api: unexpected error (request ${requestId})` : "api: unexpected error", error);
    return Response.json(
      { error: "Something went wrong", code: "INTERNAL", ...ids },
      { status: 500, headers: idHeader },
    );
  }
}

/** Reads a JSON body against a schema: a malformed body is a 400 with the field names, never the values. */
export async function readJson<T>(
  req: Request,
  schema: {
    safeParse: (
      v: unknown,
    ) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } };
  },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw refuse(400, "BAD_REQUEST", "The body is not JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw refuse(400, "BAD_REQUEST", "Invalid body", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  return parsed.data;
}
