import { expect, test } from "vitest";

import { pgClientOptions } from "../scripts/pg-client-options.mjs";

type Options = { connectionString: string; ssl?: { ca?: string; rejectUnauthorized: boolean } };
const optionsOf = (env: Record<string, string>) => (pgClientOptions as (env: Record<string, string>) => Options)(env);

test("no sslmode: a plain connection string, no TLS options", () => {
  expect(optionsOf({ DATABASE_URL: "postgres://u:p@db:5432/app" })).toEqual({
    connectionString: "postgres://u:p@db:5432/app",
  });
});

test("sslmode=require: the mode leaves the URL and the CA (escaped newlines restored) is pinned", () => {
  const options = optionsOf({
    DATABASE_URL: "postgres://u:p@db:5432/app?sslmode=require&application_name=x",
    DATABASE_CA_CERT: String.raw`-----BEGIN\nabc\n-----END`,
  });
  expect(options.connectionString).toBe("postgres://u:p@db:5432/app?application_name=x");
  expect(options.ssl).toEqual({ ca: "-----BEGIN\nabc\n-----END", rejectUnauthorized: true });
});

test("sslmode=disable stays without TLS", () => {
  expect(optionsOf({ DATABASE_URL: "postgres://db/app?sslmode=disable" }).ssl).toBeUndefined();
});
