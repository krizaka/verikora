import { describe, expect, it } from "vitest";

import { poolConfig, sessionPoolConfig } from "./db";
import { MIGRATIONS } from "./migrations";

describe("db", () => {
  it("verifies the cluster's certificate against its CA, never blindly", () => {
    const config = poolConfig({
      DATABASE_URL: "postgresql://u:p@db.example:25060/verikora_db?sslmode=require",
      DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\\nX",
    });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nX", rejectUnauthorized: true });
  });

  it("speaks plain TCP to a local database", () => {
    expect(poolConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/verikora_db" }).ssl).toBeUndefined();
  });

  it("sizes the pool by DATABASE_MAX_CONNECTIONS (5 by default), and refuses a nonsense size", () => {
    const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/verikora_db" };
    expect(poolConfig(base).max).toBe(5);
    expect(poolConfig({ ...base, DATABASE_MAX_CONNECTIONS: "12" }).max).toBe(12);
    expect(() => poolConfig({ ...base, DATABASE_MAX_CONNECTIONS: "0" })).toThrow();
    expect(() => poolConfig({ ...base, DATABASE_MAX_CONNECTIONS: "many" })).toThrow();
  });

  it("keeps session locks and migrations on the direct URL, so a transaction pooler never sits under them", () => {
    const pooled = "postgresql://u:p@pool.example:25061/pool-verikora";
    const direct = "postgresql://u:p@db.example:25060/verikora_db";
    expect(poolConfig({ DATABASE_URL: pooled, DATABASE_DIRECT_URL: direct }).connectionString).toBe(pooled);
    const session = sessionPoolConfig({
      DATABASE_URL: pooled,
      DATABASE_DIRECT_URL: direct,
      DATABASE_MAX_CONNECTIONS: "30",
    });
    expect(session.connectionString).toBe(direct);
    expect(session.max).toBe(4);
  });

  it("falls back to DATABASE_URL for session locks when there is no direct URL (no pooler)", () => {
    const url = "postgresql://u:p@localhost:5432/verikora_db";
    expect(sessionPoolConfig({ DATABASE_URL: url }).connectionString).toBe(url);
  });

  it("keeps ordered, unique migrations, the first one the baseline", () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    expect(versions[0]).toBe("0001_baseline");
  });

  it("has no gap in the numbering after the baseline (two branches adding the same number must land in order)", () => {
    MIGRATIONS.map((m) => Number(m.version.slice(0, 4))).forEach((n, i) => expect(n).toBe(1 + i));
  });
});
