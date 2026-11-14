import { describe, expect, it } from "vitest";

import { legacyObjectKey, objectKey, purgeDeadline, storageFor } from "./retention";
import type { DocumentStoreDescriptor } from "./storage/port";

const D: DocumentStoreDescriptor = {
  kind: "none",
  endpoint: null,
  region: null,
  residency: "unknown",
  encrypted: false,
  owner: "krizaka",
  devOnly: false,
};

describe("keep or purge: where a new document goes", () => {
  it("not kept: purged after the check, only the report stays — whatever the store", () => {
    expect(storageFor(false, D)).toBe("none");
    expect(storageFor(false, { ...D, kind: "bunny" })).toBe("none");
  });
  it("kept: on the configured store (Bunny in development, S3), else in Krizaka's database", () => {
    expect(storageFor(true, { ...D, kind: "bunny" })).toBe("bunny");
    expect(storageFor(true, { ...D, kind: "s3" })).toBe("s3");
    expect(storageFor(true, D)).toBe("database");
  });
});

describe("object keys and the purge deadline", () => {
  it("a key follows the Kridoc space layout: tenants/<tenant>/users/<owner>/documents/<document>/original.<ext>, lowercase", () => {
    expect(objectKey("verikora-dev", "AAA", "BBB", "application/pdf")).toBe(
      "tenants/verikora-dev/users/aaa/documents/bbb/original.pdf",
    );
    expect(objectKey("t", "a", "b", "text/plain")).toBe("tenants/t/users/a/documents/b/original.txt");
  });
  it("two owners or two tenants never share a prefix, and every key starts with its space", () => {
    const a = objectKey("verikora-dev", "owner-1", "d", "text/plain");
    const b = objectKey("verikora-dev", "owner-2", "d", "text/plain");
    const c = objectKey("verikora-prod", "owner-1", "d", "text/plain");
    expect(a.startsWith("tenants/verikora-dev/users/owner-1/")).toBe(true);
    expect(b.startsWith("tenants/verikora-dev/users/owner-1/")).toBe(false);
    expect(c.startsWith("tenants/verikora-dev/")).toBe(false);
    expect(a).toMatch(/^[a-z0-9_\-/.]+$/);
  });
  it("refuses a tenant id that is not 1 to 64 of [a-z0-9_-]", () => {
    for (const bad of ["", "Verikora", "a/b", "a b", "x".repeat(65)]) {
      expect(() => objectKey(bad, "o", "d", "text/plain")).toThrow(/tenant/);
    }
  });
  it("the key of a document kept before the layout stays owner / document / original", () => {
    expect(legacyObjectKey("AAA", "BBB", "application/pdf")).toBe("aaa/bbb/original.pdf");
  });
  it("a not-kept document that is never checked is purged after the window", () => {
    expect(purgeDeadline(new Date("2026-10-22T12:00:00Z"), 24).toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });
});
