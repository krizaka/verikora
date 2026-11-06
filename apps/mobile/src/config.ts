import {
  appEnvironmentFrom,
  createApiClient,
  createAppDiscovery,
  createSessionStore,
  secureStorage,
} from "@krizaka/app-client";
import { createQueries, createVerikoraApi } from "@verikora/client";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { currentLocale } from "./i18n";

/**
 * The app's wiring, once: where the backend is comes from the signed manifest on krizaka.com (ADR-003), not from the
 * build; `EXPO_PUBLIC_APP_URL` points a development build at another machine, `EXPO_PUBLIC_APP_ENV` picks the manifest entry.
 */
export const PRODUCT = "verikora";
/** The id `@krizaka/ui` and `@krizaka/org` still know this product by, until their major release with the commercial ids (krizaka-internal#2659). */
export const BRAND_ID = "yomizaka";
export const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";

/** Until a verified manifest answers: the address of the dev deployment. */
const BAKED = { apiBase: "https://dev.verikora.com", webBase: "https://dev.verikora.com" } as const;
// @fixed: a phone call that waits longer is a phone that has lost its network
const API_TIMEOUT_MS = 20_000;

const storage = secureStorage(SecureStore);
export const session = createSessionStore({ storage, key: "verikora.session" });

/** The stage this build follows (`dev` | `prod`): `prod` hides the development-version notice (verikora#364). */
export const stage = appEnvironmentFrom(process.env.EXPO_PUBLIC_APP_ENV);

export const discovery = createAppDiscovery({
  product: PRODUCT,
  hostSuffix: "verikora.com",
  appVersion: APP_VERSION,
  baked: BAKED,
  storage,
  env: { url: process.env.EXPO_PUBLIC_APP_URL, environment: process.env.EXPO_PUBLIC_APP_ENV },
});

export const api = createApiClient({
  baseUrl: () => discovery.getService(PRODUCT).apiBase,
  session,
  fetch: (input, init) => fetch(input, init),
  language: currentLocale,
  productName: "Verikora",
  timeoutMs: API_TIMEOUT_MS,
});

/** The website, for what the app leaves to it (creating an account, the legal pages). */
export const webUrl = (path = ""): string => `${discovery.getService(PRODUCT).webBase}${path}`;

export const verikora = createVerikoraApi(api, session);
export const queries = createQueries(verikora);
