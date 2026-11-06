import { ACCEPTED_TYPES, type AcceptedType, MAX_FILE_BYTES } from "@verikora/core";

/** Why a file is refused before it leaves the phone: the same limits as the web's pre-flight, read from `/api/me/app`. */
export const PREFLIGHT_REASON = { empty: "empty", tooLarge: "tooLarge", unsupportedType: "unsupportedType" } as const;
export type PreflightReason = (typeof PREFLIGHT_REASON)[keyof typeof PREFLIGHT_REASON];

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

export interface PreflightLimits {
  maxFileBytes: number;
  allowedTypes: readonly string[];
}

/** What applies until the server's own answer arrives. */
export const DEFAULT_LIMITS: PreflightLimits = { maxFileBytes: MAX_FILE_BYTES, allowedTypes: ACCEPTED_TYPES };

export type Preflight =
  { ok: true; file: PickedFile & { mimeType: AcceptedType } } | { ok: false; reason: PreflightReason };

/** `/api/me/app` names the types it accepts by family (`pdf`, `text`); the picker reports MIME types. */
const MIME_OF_FAMILY: Record<string, AcceptedType> = { pdf: "application/pdf", text: "text/plain" };

export function limitsFromConfig(config: { maxFileBytes: number; allowedTypes: readonly string[] }): PreflightLimits {
  return {
    maxFileBytes: config.maxFileBytes,
    allowedTypes: config.allowedTypes.flatMap((family) => MIME_OF_FAMILY[family] ?? []),
  };
}

/** What the system picker reports is not always set: the file's extension says it too. */
const TYPE_OF_EXTENSION: Record<string, AcceptedType> = { pdf: "application/pdf", txt: "text/plain" };

export const mimeTypeOf = (name: string, reported: string | null): string | null =>
  reported ?? TYPE_OF_EXTENSION[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""] ?? null;

export function preflight(file: PickedFile, limits: PreflightLimits = DEFAULT_LIMITS): Preflight {
  if (file.size === 0) return { ok: false, reason: PREFLIGHT_REASON.empty };
  if (file.size !== null && file.size > limits.maxFileBytes) return { ok: false, reason: PREFLIGHT_REASON.tooLarge };
  const type = mimeTypeOf(file.name, file.mimeType) ?? "";
  if (!isAccepted(type, limits)) return { ok: false, reason: PREFLIGHT_REASON.unsupportedType };
  return { ok: true, file: { ...file, mimeType: type } };
}

const isAccepted = (type: string, limits: PreflightLimits): type is AcceptedType =>
  limits.allowedTypes.includes(type) && (ACCEPTED_TYPES as readonly string[]).includes(type);
