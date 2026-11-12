import { logError } from "./log";

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

/** Runs a route handler: an HttpError becomes its JSON answer; anything else is a 500 that leaks nothing. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) {
      // The code also rides in a header: the DigitalOcean ingress replaces a 502's body with its own page and keeps the headers (krizaka-internal#3214).
      const code = codeOf(error, "");
      return Response.json(
        { error: error.message, ...error.body },
        { status: error.status, headers: { ...error.headers, ...(code ? { "X-Error-Code": code } : {}) } },
      );
    }
    logError("api: unexpected error", error);
    return Response.json({ error: "Something went wrong", code: "INTERNAL" }, { status: 500 });
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
