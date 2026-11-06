import { HttpError, refuse } from "../http";

/**
 * A refusal of the settings service as the HTTP answer it deserves (verikora#252). Recognised by what it is — name, status, code —
 * not by `instanceof`: the deployed bundle answered 500 INTERNAL for a setting refused at a scope (`BAD_SCOPE`, 400) while the same
 * code answered 400 in the tests, the signature of two copies of the package's class meeting in one process.
 */
const REFUSALS = new Set(["SettingsError", "PriceError"]);

/** The same for the price catalogue's refusals (`PriceError`: UNKNOWN_PRICE, BAD_VALUE, BAD_DATE). */
export function settingsRefusal(error: unknown): HttpError | null {
  const e = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || !REFUSALS.has(String(e.name)) || typeof e.status !== "number" || typeof e.code !== "string") return null;
  return refuse(e.status, e.code, typeof e.message === "string" ? e.message : e.code);
}
