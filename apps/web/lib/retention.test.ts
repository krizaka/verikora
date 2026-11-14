import { describe, expect, it } from "vitest";

import { objectKey, purgeDeadline, storageFor } from "./retention";
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
  it("a key is owner / document / original with the file's extension, lowercase", () => {
    expect(objectKey("AAA", "BBB", "application/pdf")).toBe("aaa/bbb/original.pdf");
    expect(objectKey("a", "b", "text/plain")).toBe("a/b/original.txt");
  });
  it("a not-kept document that is never checked is purged after the window", () => {
    expect(purgeDeadline(new Date("2026-10-22T12:00:00Z"), 24).toISOString()).toBe("2026-10-23T12:00:00.000Z");
  });
});
