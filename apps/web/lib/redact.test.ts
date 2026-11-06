import { afterEach, describe, expect, it, vi } from "vitest";

import { poolConfig, sessionPoolConfig } from "./db";
import { logError } from "./log";
import { describeError, REDACTED, redactSecrets, sanitizedError } from "./redact";

// Fake credentials, shaped like the real ones: a failing connection must never print any part of them.
const PASSWORD = "s3cr3t-Pa55w0rd";
const BAD_URL = `postgresql://verikora_db:${PASSWORD}@<nil>:<nil>/verikora_db?sslmode=require`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("redactSecrets", () => {
  it("hides URLs that carry credentials and every database address", () => {
    expect(redactSecrets(`connect ${BAD_URL} failed`)).toBe(`connect ${REDACTED} failed`);
    expect(redactSecrets("https://user:pw@example.com/x")).toBe(REDACTED);
    expect(redactSecrets("postgresql://db.example:25060/verikora_db")).toBe(REDACTED);
  });

  it("hides key=value credentials", () => {
    expect(redactSecrets(`options password=${PASSWORD} host=x`)).toBe(`options password=${REDACTED} host=x`);
  });

  it("leaves a plain message alone", () => {
    expect(redactSecrets("DATABASE_URL is not set")).toBe("DATABASE_URL is not set");
  });
});

describe("describeError", () => {
  it("never prints the properties of an error, nor a URL in its message or its cause", () => {
    const cause = new Error(`getaddrinfo failed for ${BAD_URL}`);
    const error = Object.assign(new Error(`Invalid URL ${BAD_URL}`, { cause }), {
      code: "ERR_INVALID_URL",
      input: BAD_URL,
    });
    const line = describeError(error);
    expect(line).toContain("ERR_INVALID_URL");
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain("verikora_db:");
    expect(sanitizedError(error).cause).toBeUndefined();
    expect(Object.keys(sanitizedError(error))).toEqual([]);
  });
});

describe("a failing database connection logs no password (verikora#386)", () => {
  it("names the wrong variable and shows no part of its value", () => {
    for (const run of [
      () => poolConfig({ DATABASE_URL: BAD_URL }),
      () => sessionPoolConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/d", DATABASE_DIRECT_URL: BAD_URL }),
    ]) {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const text = JSON.stringify(thrown, Object.getOwnPropertyNames(thrown as object));
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("verikora_db:");
      expect((thrown as Error).message).toMatch(/DATABASE_(DIRECT_)?URL is not a valid URL/);
    }
  });

  it("says which variable has no host", () => {
    expect(() => poolConfig({ DATABASE_URL: "postgresql:///verikora_db" })).toThrow("DATABASE_URL has no host");
  });

  it("start-up logs a redacted line and throws a clean error, whatever the database layer throws", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")].map((s) =>
      s.mockImplementation(() => undefined),
    );
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.doMock("./env", () => ({
      assertProductionEnv: () => undefined,
      readEnv: () => ({ DATABASE_URL: BAD_URL, DATABASE_DIRECT_URL: undefined, DATABASE_MAX_CONNECTIONS: 5 }),
    }));
    vi.doMock("./db", () => ({
      migrate: async () => {
        throw Object.assign(new Error(`Invalid URL: ${BAD_URL}`), { code: "ERR_INVALID_URL", input: BAD_URL });
      },
    }));
    const { register } = await import("../instrumentation");
    const failure = await register().then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).not.toContain(PASSWORD);
    const printed = spies
      .flatMap((s) => s.mock.calls.flat())
      .map(String)
      .join("\n");
    expect(printed).toContain("start-up failed");
    expect(printed).not.toContain(PASSWORD);
    expect(printed).not.toContain("verikora_db:");
  });

  it("logError never prints an error object's own properties", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logError("api failed:", Object.assign(new Error("boom"), { config: { connectionString: BAD_URL } }));
    expect(spy.mock.calls.flat().map(String).join("\n")).not.toContain(PASSWORD);
  });
});

describe("a log line carries no e-mail address, bearer token or session token (krizaka-internal#2385)", () => {
  it("hides an e-mail address", () => {
    expect(redactSecrets("sign-up failed for eric@example.com twice")).toBe(`sign-up failed for ${REDACTED} twice`);
  });

  it("hides a bearer token and a session token", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123_xyz")).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactSecrets("cookie ys1.AbCdEf0123456789_-xyz rejected")).toBe(`cookie ${REDACTED} rejected`);
  });

  it("hides a token in a query string and a signature header value", () => {
    expect(redactSecrets("GET /api/x?access_token=abc123&a=1")).toBe(`GET /api/x?access_token=${REDACTED}&a=1`);
    expect(redactSecrets("stripe-signature=t=1,v1=deadbeef")).toBe(`stripe-signature=${REDACTED}`);
  });
});
