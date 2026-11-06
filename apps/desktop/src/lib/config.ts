import {
  appEnvironmentFrom,
  browserStorage,
  createApiClient,
  createAppDiscovery,
  createSessionStore,
} from "@krizaka/app-client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createQueries, createVerikoraApi } from "@verikora/client";

import { currentLocale } from "../i18n";
import { keychain } from "./desktop";

/** The Mac app's wiring, once. The backend comes from the signed manifest on krizaka.com (ADR-003), like the phone's. */
export const PRODUCT = "verikora";
/** The id `@krizaka/ui` and `@krizaka/org` still know this product by, until their major release with the commercial ids (krizaka-internal#2659). */
export const BRAND_ID = "yomizaka";
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.1.0";
// @fixed: a call that waits longer is a Mac that has lost its network
const API_TIMEOUT_MS = 30_000;
const BAKED = { apiBase: "https://dev.verikora.com", webBase: "https://dev.verikora.com" } as const;

/** The session lives in the Keychain (tauri-plugin-krizaka), never in the page's storage: the same store as the phone's. */
export const session = createSessionStore({ storage: keychain, key: "verikora.session" });

/** The stage this build follows (`dev` | `prod`): `prod` hides the development-version notice (verikora#364). */
export const stage = appEnvironmentFrom(import.meta.env.VITE_APP_ENV);

export const discovery = createAppDiscovery({
  product: PRODUCT,
  hostSuffix: "verikora.com",
  appVersion: APP_VERSION,
  baked: BAKED,
  storage: browserStorage(() => globalThis.localStorage),
  env: { url: import.meta.env.VITE_APP_URL, environment: import.meta.env.VITE_APP_ENV },
});

/** The calls go through Rust's HTTP client (no CORS): the page may reach Verikora's own addresses and nothing else. */
export const api = createApiClient({
  baseUrl: () => discovery.getService(PRODUCT).apiBase,
  session,
  fetch: (input, init) => tauriFetch(input, init),
  language: currentLocale,
  productName: "Verikora",
  timeoutMs: API_TIMEOUT_MS,
});

export const verikora = createVerikoraApi(api, session);
export const queries = createQueries(verikora);
export const webUrl = (path = ""): string => `${discovery.getService(PRODUCT).webBase}${path}`;
