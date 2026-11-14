import { createSovkoraClient as createSharedClient } from "@krizaka/sovkora-client";
import { type RunPayload, sovkoraRun, type Studio } from "@verikora/core";
import { z } from "zod";

import { systemClock } from "../app/system-clock";
import { readEnv } from "./env";
import { codeOf, HttpError, refuse } from "./http";
import { logInfo } from "./log";
import { engineDoor, standingConsent } from "./screening-checks/engine-door";
import type { ChecksDoor } from "./screening-checks/model";

/**
 * Sovkora's edge — the only place Verikora's analyses run. Verikora calls it with its service key (`oz_…`, a DO
 * SECRET): the edge exchanges the key for a session of the `svc_verikora` account, whose operator grants open the
 * document Studios. No model is ever called from here; Verikora keeps the run id as the trace of what ran.
 *
 *   GET  /api/v1/studios/installations         the Studios this account installed
 *   POST /api/v1/studios/{studio}/installations install one (once)
 *   POST /api/v1/studios/{studio}/runs         start a run: { inputs } → 202 + the run
 *   GET  /api/v1/studios/runs/{runId}          the run, its status and outputs
 */
type Fetch = typeof fetch;

export interface AnalysisEngine {
  startRun(studio: Studio, inputs: Record<string, string>): Promise<RunPayload>;
  getRun(runId: string): Promise<RunPayload>;
  /** The Studios this product's key has installed — also the cheapest call that proves the key and the connection. */
  studios(): Promise<string[]>;
}

const installation = z.object({ studioKey: z.string(), pinnedVersion: z.string().optional() });

/** What a refusal of Sovkora's means for Verikora — a stable code the UI translates. */
export function engineRefusal(status: number): { status: number; code: string } {
  if (status === 401 || status === 403) return { status: 502, code: "SOVKORA_KEY" };
  if (status === 402) return { status: 502, code: "SOVKORA_CREDITS" };
  if (status === 409) return { status: 502, code: "SOVKORA_LOCKED" };
  if (status === 400 || status === 422) return { status: 422, code: "SOVKORA_INPUT" };
  if (status === 404) return { status: 502, code: "SOVKORA_NOT_FOUND" };
  // « too many concurrent runs »: the engine says when to come back; not a failure of the document (verikora#248).
  if (status === 429) return { status: 429, code: "SOVKORA_BUSY" };
  return { status: 502, code: "SOVKORA_UNAVAILABLE" };
}

/** Whether an installation pinned on this version reads a declared kind (2.x and later; not told: assumed so). */
export const kindIsRead = (pinnedVersion: string | undefined): boolean =>
  pinnedVersion === undefined || Number.parseInt(pinnedVersion, 10) >= 2;

/**
 * The one deadline of a run start (installation + run), shared by its calls. Below the ingress's own (DigitalOcean answers a bare 504
 * HTML page): past it the start answers `SOVKORA_UNAVAILABLE`, a code the UI says and a batch waits on (krizaka-internal#3214).
 */
// @fixed: a technical bound below the ingress's timeout, not a business setting
export const START_DEADLINE_MS = 25_000;

/** Rejects when the signal aborts, whether or not the work honours it (a fetch, or a body read, that never answers). */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** The seconds a `Retry-After` header asks for (a number, bounded), or null when it says nothing usable. */
function retryHint(header: string | null): number | null {
  const seconds = Number(header);
  return header?.trim() && Number.isFinite(seconds) && seconds > 0 ? Math.min(300, Math.ceil(seconds)) : null;
}

/** Sovkora's answer read against its schema, or its refusal as a stable code. */
async function read<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  if (!res.ok) {
    const { status, code } = engineRefusal(res.status);
    if (res.status === 429) {
      const wait = Math.min(
        300,
        Math.max(
          1,
          Number(((await res.json().catch(() => null)) as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds) ||
            15,
        ),
      );
      throw new HttpError(
        status,
        `Sovkora is busy on ${what}`,
        { code, retryAfter: wait },
        { "Retry-After": String(wait) },
      );
    }
    // A down or slow backend: Sovkora's coded 5xx says when to come back; it is passed on (krizaka-internal#3225).
    const hint = res.status >= 500 ? retryHint(res.headers.get("retry-after")) : null;
    if (hint !== null) {
      throw new HttpError(
        status,
        `Sovkora answered ${res.status} on ${what}`,
        { code, retryAfter: hint },
        { "Retry-After": String(hint) },
      );
    }
    throw refuse(status, code, `Sovkora answered ${res.status} on ${what}`);
  }
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw refuse(502, "SOVKORA_SHAPE", `Sovkora's answer to ${what} has an unexpected shape`);
  return parsed.data;
}

export function createAnalysisEngine(options: {
  baseUrl: string;
  apiKey: string | undefined;
  fetch?: Fetch;
  /** One call's bound. */
  timeoutMs?: number;
  /** The whole run start's bound (all its calls). */
  startDeadlineMs?: number;
  /** One line per call: method, path (no query), status and code, elapsed time; never the key. */
  log?: (line: string) => void;
}): AnalysisEngine {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const installed = new Map<string, string | undefined>();
  const log = options.log ?? logInfo;

  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method?: string; body?: unknown; deadline?: AbortSignal } = {},
  ): Promise<T> {
    if (!options.apiKey) throw refuse(503, "SOVKORA_NOT_CONFIGURED", "AI_API_KEY is not set");
    const method = init.method ?? "GET";
    const route = path.split("?")[0]!;
    const perCall = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    const signal = init.deadline ? AbortSignal.any([perCall, init.deadline]) : perCall;
    const started = performance.now();
    const line = (...parts: (string | number | undefined)[]) =>
      log(
        ["sovkora:", method, route, ...parts, `in ${Math.round(performance.now() - started)} ms`]
          .filter((p) => p !== undefined && p !== "")
          .join(" "),
      );
    let status: number | undefined;
    try {
      const res = await within(
        doFetch(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            accept: "application/json",
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal,
          cache: "no-store",
        }),
        signal,
      );
      status = res.status;
      const data = await within(read(res, schema, `${method} ${route}`), signal);
      line(status);
      return data;
    } catch (error) {
      if (error instanceof HttpError) {
        line(status, codeOf(error, ""));
        throw error;
      }
      line(status, "no answer");
      throw refuse(502, "SOVKORA_UNAVAILABLE", `Sovkora did not answer ${method} ${route} in time`);
    }
  }

  /** The version this account's installation is pinned on (undefined: not told). Installs the Studio once when it is not. */
  async function ensureInstalled(studio: Studio, deadline: AbortSignal): Promise<string | undefined> {
    if (installed.has(studio)) return installed.get(studio);
    const mine = await call("/api/v1/studios/installations", z.array(installation), { deadline });
    const found =
      mine.find((i) => i.studioKey === studio) ??
      (await call(`/api/v1/studios/${studio}/installations?locale=en`, installation, {
        method: "POST",
        body: { config: {} },
        deadline,
      }));
    installed.set(studio, found.pinnedVersion);
    return found.pinnedVersion;
  }

  return {
    async startRun(studio, inputs) {
      const deadline = AbortSignal.timeout(options.startDeadlineMs ?? START_DEADLINE_MS);
      const pinned = await ensureInstalled(studio, deadline);
      // A kind declared to the Studio (visit notice, état des lieux) is read by compliance-check 2.x only; a 1.x installation would ignore it and judge the document as a lease.
      if (inputs.declaredKind && !kindIsRead(pinned))
        throw refuse(
          422,
          "SOVKORA_STUDIO_OLD",
          "This Studio's installation is on 1.x: it cannot read this kind of document yet",
        );
      return call(`/api/v1/studios/${studio}/runs`, sovkoraRun, { method: "POST", body: { inputs }, deadline });
    },
    async studios() {
      return (await call("/api/v1/studios/installations", z.array(installation))).map((i) => i.studioKey);
    },
    getRun(runId) {
      if (!/^[0-9a-f-]{36}$/i.test(runId)) throw refuse(400, "BAD_RUN", "Not a run id");
      return call(`/api/v1/studios/runs/${runId}`, sovkoraRun);
    },
  };
}

const holder = globalThis as unknown as { __verikoraSovkora?: AnalysisEngine };

export function sovkora(): AnalysisEngine {
  if (holder.__verikoraSovkora) return holder.__verikoraSovkora;
  const env = readEnv();
  holder.__verikoraSovkora = createAnalysisEngine({ baseUrl: env.AI_API_URL, apiKey: env.AI_API_KEY });
  return holder.__verikoraSovkora;
}

/** Tests: use this client (null: back to the configured one). */
export function useSovkoraClient(client: AnalysisEngine | null) {
  holder.__verikoraSovkora = client ?? undefined;
}

/** The door for external checks (sovkora-engine#105): the shared client with this product's service key, `AI_API_URL` / `AI_API_KEY`. */
export function checksDoor(): ChecksDoor {
  const env = readEnv();
  return engineDoor(
    createSharedClient({ baseUrl: env.AI_API_URL, apiKey: env.AI_API_KEY, clock: systemClock }),
    standingConsent,
  );
}
