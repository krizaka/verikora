import { describe, expect, it } from "vitest";

import type { DocumentStoreDescriptor } from "./port";
import { storageNotice, storedAs } from "./where";

const D = {
  endpoint: null,
  region: null,
  residency: "unknown",
  encrypted: false,
  owner: "krizaka",
  devOnly: false,
} as const;

describe("where a document lives, as the info panel says it", () => {
  it.each([
    ["not kept", { kind: "none" }, { key: "none", vars: {} }],
    [
      "the database of the Toronto region, encrypted",
      { kind: "database", region: "tor1", residency: "canada", encrypted: true },
      { key: "krizakaCanadaEncrypted", vars: {} },
    ],
    [
      "Spaces tor1, encrypted",
      { kind: "s3", endpoint: "tor1.digitaloceanspaces.com", region: "tor1", residency: "canada", encrypted: true },
      { key: "krizakaCanadaEncrypted", vars: {} },
    ],
    [
      "Krizaka in Canada, not encrypted",
      { kind: "s3", residency: "canada", encrypted: false },
      { key: "krizakaCanada", vars: {} },
    ],
    [
      "Krizaka outside Canada says the region",
      { kind: "s3", region: "eu-west-3", residency: "elsewhere" },
      { key: "krizakaElsewhere", vars: { region: "eu-west-3" } },
    ],
    [
      "the workspace's own storage says the host and region",
      { kind: "s3", owner: "workspace", endpoint: "s3.example.com", region: "ca-central-1", residency: "canada" },
      { key: "workspace", vars: { endpoint: "s3.example.com", region: "ca-central-1" } },
    ],
    [
      "the development store is for fictional data",
      { kind: "bunny", residency: "elsewhere", devOnly: true },
      { key: "devOnly", vars: {} },
    ],
    ["on the device", { kind: "device", owner: "device", residency: "device" }, { key: "device", vars: {} }],
  ] as const)("%s", (_name, override, expected) =>
    expect(storageNotice({ ...D, ...override } as DocumentStoreDescriptor)).toEqual(expected),
  );
});

describe("a stored document's descriptor", () => {
  const active = {
    ...D,
    kind: "s3",
    endpoint: "tor1.digitaloceanspaces.com",
    region: "tor1",
    residency: "canada",
    encrypted: true,
  } as const;
  it("follows its own kind: in the database, not kept, or on the active store when it is the same", () => {
    expect(storedAs("database", active)).toMatchObject({ kind: "database", residency: "canada", encrypted: true });
    expect(storedAs("none", active)).toMatchObject({ kind: "none" });
    expect(storedAs("s3", active)).toEqual(active);
  });
  it("a document on a store that is no longer configured says only its kind, with an unknown residency", () => {
    expect(storedAs("bunny", active)).toMatchObject({ kind: "bunny", residency: "unknown", devOnly: true });
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("the info panel", () => {
  it("is on the document's information tab and offers « Supprimer maintenant »", () => {
    const view = readFileSync(join(__dirname, "../../components/console/DocumentFileTab.tsx"), "utf8");
    expect(view).toMatch(/<StorageNotice\s+storage=\{doc\.storage\}/);
    expect(readFileSync(join(__dirname, "../../components/console/StorageNotice.tsx"), "utf8")).toContain(
      "document.where.deleteNow",
    );
  });
});
