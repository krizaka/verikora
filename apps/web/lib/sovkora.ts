import { createOrazakaClient as createSharedClient } from "@krizaka/orazaka-client";
import { type SovkoraRun, sovkoraRun, type Studio } from "@verikora/core";
import { z } from "zod";

import { systemClock } from "../app/system-clock";
import { readEnv } from "./env";
import { HttpError, refuse } from "./http";
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

export interface SovkoraClient {
  startRun(studio: Studio, inputs: Record<string, string>): Promise<SovkoraRun>;
  getRun(runId: string): Promise<SovkoraRun>;
  /** The Studios this product's key has installed — also the cheapest call that proves the key and the connection. */
  studios(): Promise<string[]>;
}

const installation = z.object({ studioKey: z.string(), pinnedVersion: z.string().optional() });

/** What a refusal of Sovkora's means for Verikora — a stable code the UI translates. */
export function sovkoraRefusal(status: number): { status: number; code: string } {
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

export function createSovkoraClient(options: {
  baseUrl: string;
  apiKey: string | undefined;
  fetch?: Fetch;
  timeoutMs?: number;
}): SovkoraClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  const installed = new Map<string, string | undefined>();

  async function call<T>(
    path: string,
    schema: z.ZodType<T>,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    if (!options.apiKey) throw refuse(503, "SOVKORA_NOT_CONFIGURED", "AI_API_KEY is not set");
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        cache: "no-store",
      });
    } catch {
      throw refuse(502, "SOVKORA_UNAVAILABLE", "Sovkora did not answer");
    }
    if (!res.ok) {
      const { status, code } = sovkoraRefusal(res.status);
      if (res.status === 429) {
        const wait = Math.min(
          300,
          Math.max(
            1,
            Number(
              ((await res.json().catch(() => null)) as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds,
            ) || 15,
          ),
        );
        throw new HttpError(
          status,
          `Sovkora is busy on ${init.method ?? "GET"} ${path.split("?")[0]}`,
          { code, retryAfter: wait },
          { "Retry-After": String(wait) },
        );
      }
      throw refuse(status, code, `Sovkora answered ${res.status} on ${init.method ?? "GET"} ${path.split("?")[0]}`);
    }
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw refuse(502, "SOVKORA_SHAPE", `Sovkora's answer to ${path} has an unexpected shape`);
    return parsed.data;
  }

  /** The version this account's installation is pinned on (undefined: not told). Installs the Studio once when it is not. */
  async function ensureInstalled(studio: Studio): Promise<string | undefined> {
    if (installed.has(studio)) return installed.get(studio);
    const mine = await call("/api/v1/studios/installations", z.array(installation));
    const found =
      mine.find((i) => i.studioKey === studio) ??
      (await call(`/api/v1/studios/${studio}/installations?locale=en`, installation, {
        method: "POST",
        body: { config: {} },
      }));
    installed.set(studio, found.pinnedVersion);
    return found.pinnedVersion;
  }

  return {
    async startRun(studio, inputs) {
      const pinned = await ensureInstalled(studio);
      // A kind declared to the Studio (visit notice, état des lieux) is read by compliance-check 2.x only; a 1.x installation would ignore it and judge the document as a lease.
      if (inputs.declaredKind && !kindIsRead(pinned))
        throw refuse(
          422,
          "SOVKORA_STUDIO_OLD",
          "This Studio's installation is on 1.x: it cannot read this kind of document yet",
        );
      return call(`/api/v1/studios/${studio}/runs`, sovkoraRun, { method: "POST", body: { inputs } });
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

const holder = globalThis as unknown as { __verikoraSovkora?: SovkoraClient };

export function sovkora(): SovkoraClient {
  if (holder.__verikoraSovkora) return holder.__verikoraSovkora;
  const env = readEnv();
  holder.__verikoraSovkora = createSovkoraClient({ baseUrl: env.AI_API_URL, apiKey: env.AI_API_KEY });
  return holder.__verikoraSovkora;
}

/** Tests: use this client (null: back to the configured one). */
export function useSovkoraClient(client: SovkoraClient | null) {
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
