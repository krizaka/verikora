import { appEnvironmentFrom, browserStorage, createApiClient, createAppDiscovery, createSessionStore } from "@krizaka/app-client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createQueries, createYomizakaApi } from "@yomizaka/client";

import { currentLocale } from "../i18n";
import { keychain } from "./desktop";

/** The Mac app's wiring, once. The backend comes from the signed manifest on krizaka.com (ADR-003), like the phone's. */
export const PRODUCT = "yomizaka";
/** The stage of this build (`VITE_APP_ENV`: dev or prod, dev when unset): the « development version » notice follows it. */
export const APP_ENV = appEnvironmentFrom(import.meta.env.VITE_APP_ENV);
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.1.0";
// @fixed: a call that waits longer is a Mac that has lost its network
const API_TIMEOUT_MS = 30_000;
const BAKED = { apiBase: "https://dev.yomizaka.com", webBase: "https://dev.yomizaka.com" } as const;

/** The session lives in the Keychain (tauri-plugin-krizaka), never in the page's storage: the same store as the phone's. */
export const session = createSessionStore({ storage: keychain, key: "yomizaka.session" });

export const discovery = createAppDiscovery({
  product: PRODUCT,
  hostSuffix: "yomizaka.com",
  appVersion: APP_VERSION,
  baked: BAKED,
  storage: browserStorage(() => window.localStorage),
  env: { url: import.meta.env.VITE_APP_URL, environment: APP_ENV },
});

/** The calls go through Rust's HTTP client (no CORS): the page may reach Yomizaka's own addresses and nothing else. */
export const api = createApiClient({
  baseUrl: () => discovery.getService(PRODUCT).apiBase,
  session,
  fetch: (input, init) => tauriFetch(input, init),
  language: currentLocale,
  productName: "Yomizaka",
  timeoutMs: API_TIMEOUT_MS,
});

export const yomizaka = createYomizakaApi(api, session);
export const queries = createQueries(yomizaka);
export const webUrl = (path = ""): string => `${discovery.getService(PRODUCT).webBase}${path}`;
