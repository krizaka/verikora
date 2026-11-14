import { query } from "../db";
import { postgresVerikoraSettings, type VerikoraSettings } from "./service";

/** One instance per process, shared by every bundle (pages and routes are bundled apart): a change made in a route is seen by the next page at once. */
const holder = globalThis as unknown as { __verikoraSettings?: VerikoraSettings };

/** This deployment's settings service: the app's own PostgreSQL and a monotonic clock for its short cache (never the wall clock). */
export function appSettings(): VerikoraSettings {
  holder.__verikoraSettings ??= postgresVerikoraSettings({ query, clock: () => performance.now() });
  return holder.__verikoraSettings;
}

/** For tests: forget the cached service. */
export const resetAppSettings = () => {
  holder.__verikoraSettings = undefined;
};
