import { describe, expect, it } from "vitest";

import { productionProblems, readEnv } from "./env";

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
