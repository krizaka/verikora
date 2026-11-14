import { describe, expect, it } from "vitest";

import { documentsTenant, productionProblems, readEnv } from "./env";

const PROD = { NODE_ENV: "production", APP_ENVIRONMENT: "prod", DATABASE_URL: undefined };

describe("the documents tenant id (Kridoc space layout)", () => {
  it("is required in production", () => {
    expect(productionProblems(readEnv(PROD)).join()).toMatch(/MEDIA_DOCUMENTS_TENANT is not set/);
    expect(productionProblems(readEnv({ ...PROD, MEDIA_DOCUMENTS_TENANT: "verikora-prod" })).join()).not.toMatch(
      /MEDIA_DOCUMENTS_TENANT/,
    );
  });
  it("an invalid value fails the read, anywhere", () => {
    expect(() => readEnv({ MEDIA_DOCUMENTS_TENANT: "Verikora Prod" })).toThrow(/MEDIA_DOCUMENTS_TENANT/);
  });
  it("is verikora-dev outside production when unset, and throws in production", () => {
    expect(documentsTenant({ NODE_ENV: "development" })).toBe("verikora-dev");
    expect(documentsTenant({ NODE_ENV: "development", MEDIA_DOCUMENTS_TENANT: "verikora-x" })).toBe("verikora-x");
    expect(() => documentsTenant({ NODE_ENV: "production" })).toThrow(/MEDIA_DOCUMENTS_TENANT/);
  });
});

describe("the documents store in production", () => {
  it("refuses Bunny: it has no Canadian region", () => {
    const source = {
      NODE_ENV: "production",
      APP_ENVIRONMENT: "prod",
      MEDIA_DOCUMENTS_PROVIDER: "bunny",
      MEDIA_STORAGE_API_KEY: "zone-key",
      MEDIA_STORAGE_ZONE: "krizaka-assets",
      MEDIA_STORAGE_ENDPOINT: "storage.bunnycdn.com",
      MEDIA_DOCUMENTS_PREFIX: "verikora",
      DATABASE_URL: undefined,
    };
    expect(productionProblems(readEnv(source))).toContain(
      "MEDIA_DOCUMENTS_PROVIDER=bunny has no Canadian region: development and fictional data only",
    );
  });
});
