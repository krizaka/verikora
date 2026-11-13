import { type PreflightLimits, type PreflightReason, preflight } from "@verikora/client";

import { bytesOf, isNativeError, verikoraNative } from "./desktop";

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
  const megabytes = Math.floor(limits.maxFileBytes / MEGABYTE);
  const document = await verikoraNative.readDocument(path, limits.maxFileBytes).catch((error: unknown) => {
    // The native layer stops at the server's limit: the person reads the same sentence as the pre-flight's.
    throw isNativeError(error, "too_large") ? new Refused("tooLarge", megabytes) : new Refused("unreadable");
  });
  const verdict = preflight({ uri: path, name: document.name, mimeType: document.mime, size: document.size }, limits);
  if (!verdict.ok) throw new Refused(verdict.reason, megabytes);
  return { path, name: document.name, blob: new Blob([bytesOf(document.data)], { type: document.mime }) };
}
