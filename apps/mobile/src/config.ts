import { appEnvironmentFrom, createApiClient, createAppDiscovery, createSessionStore, secureStorage } from "@krizaka/app-client";
import { createQueries, createYomizakaApi } from "@yomizaka/client";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { currentLocale } from "./i18n";

/**
 * The app's wiring, once: where the backend is comes from the signed manifest on krizaka.com (ADR-003), not from the
 * build; `EXPO_PUBLIC_APP_URL` points a development build at another machine, `EXPO_PUBLIC_APP_ENV` picks the manifest entry.
 */
export const PRODUCT = "yomizaka";
/** The stage of this build (`EXPO_PUBLIC_APP_ENV`: dev or prod, dev when unset): the « development version » notice follows it. */
export const APP_ENV = appEnvironmentFrom(process.env.EXPO_PUBLIC_APP_ENV);
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** Until a verified manifest answers: the address of the dev deployment. */
const BAKED = { apiBase: "https://dev.yomizaka.com", webBase: "https://dev.yomizaka.com" } as const;
// @fixed: a phone call that waits longer is a phone that has lost its network
const API_TIMEOUT_MS = 20_000;

const storage = secureStorage(SecureStore);
export const session = createSessionStore({ storage, key: "yomizaka.session" });

export const discovery = createAppDiscovery({
  product: PRODUCT,
  hostSuffix: "yomizaka.com",
  appVersion: APP_VERSION,
  baked: BAKED,
  storage,
  env: { url: process.env.EXPO_PUBLIC_APP_URL, environment: APP_ENV },
});

export const api = createApiClient({
  baseUrl: () => discovery.getService(PRODUCT).apiBase,
  session,
  fetch: (input, init) => fetch(input, init),
  language: currentLocale,
  productName: "Yomizaka",
  timeoutMs: API_TIMEOUT_MS,
});

/** The website, for what the app leaves to it (creating an account, the legal pages). */
export const webUrl = (path = ""): string => `${discovery.getService(PRODUCT).webBase}${path}`;

export const yomizaka = createYomizakaApi(api, session);
export const queries = createQueries(yomizaka);
