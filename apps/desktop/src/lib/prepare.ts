import { type PreflightLimits, type PreflightReason, preflight } from "@verikora/client";

import { bytesOf, verikoraNative } from "./desktop";

/** Why a file did not become a check: a refusal of the pre-flight, or the server's. */
export class Refused extends Error {
  constructor(
    readonly reason: PreflightReason | "paywall" | "unreadable" | "failed" | "feature",
    /** The server's limit, for « too large »: what the person reads. */
    readonly megabytes?: number,
  ) {
    super(reason);
  }
}

// @fixed: a megabyte, a unit, not a setting
const MEGABYTE = 1024 * 1024;

export interface Prepared {
  path: string;
  name: string;
  blob: Blob;
}

/**
 * A document of the Mac made ready for the one check that needs it: read through the folder scope, then the web's
 * pre-flight (the server's limits). Nothing leaves the Mac before this answers.
 */
export async function prepare(path: string, limits: PreflightLimits): Promise<Prepared> {
  const document = await verikoraNative.readDocument(path).catch(() => {
    throw new Refused("unreadable");
  });
  const verdict = preflight({ uri: path, name: document.name, mimeType: document.mime, size: document.size }, limits);
  if (!verdict.ok) throw new Refused(verdict.reason, Math.floor(limits.maxFileBytes / MEGABYTE));
  return { path, name: document.name, blob: new Blob([bytesOf(document.data)], { type: document.mime }) };
}
