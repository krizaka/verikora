import type { CloudOwner, StorageKind } from "@verikora/core";
import type { QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentStore } from "../storage/port";

const working = vi.hoisted(() => ({ store: null as unknown }));

vi.mock("@/app/active-store", () => ({ workingStore: () => working.store }));
vi.mock("../billing", () => ({
  ledgerState: async () => ({ credits: 4, freeAuditUsed: true }),
}));

import { exportData, holderFrom, type StoresOf } from "./export";

const NOW = new Date("2026-07-08T09:10:11Z");
const ACCOUNT = "acc-1";

type Rows = Record<string, QueryResultRow[]>;

/** A Query that answers by the table the statement reads, and records every statement it was sent. */
function fakeQuery(rows: Rows) {
  const sent: { text: string; values: unknown[] | undefined }[] = [];
  const order: [string, string][] = [
    ["FROM accounts", "account"],
    ["FROM libraries", "libraries"],
    ["FROM collections c WHERE", "collections"],
    ["FROM folders f", "folders"],
    ["FROM tags WHERE", "tags"],
    ["collections_tags", "collectionTags"],
    ["folder_tags", "folderTags"],
    ["organize.document_tag", "documentTags"],
    ["FROM documents", "documents"],
    ["FROM analyses", "analyses"],
  ];
  const q = async <T extends QueryResultRow>(text: string, values?: unknown[]): Promise<T[]> => {
    sent.push({ text, values });
    const hit = order.find(([fragment]) => text.includes(fragment));
    if (!hit) {
      throw new Error(`unexpected statement: ${text}`);
    }
    return (rows[hit[1]] ?? []) as T[];
  };
  return { q, sent };
}

const account = (over: QueryResultRow = {}): QueryResultRow => ({
  id: ACCOUNT,
  email: "p@verikora.test",
  name: "Pat",
  locale: "fr",
  perspective: "tenant",
  created_at: new Date("2026-01-02T03:04:05Z"),
  terms_accepted_at: new Date("2026-01-03T00:00:00Z"),
  privacy_accepted_at: null,
  plan: "pro",
  subscription_status: "active",
  current_period_end: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const doc = (id: string, over: QueryResultRow = {}): QueryResultRow => ({
  id,
  title: `Title ${id}`,
  filename: `${id}.pdf`,
  mime_type: "application/pdf",
  kind: "lease",
  size_bytes: 3,
  sha256: "a".repeat(64),
  pages: 2,
  created_at: new Date("2026-02-01T00:00:00Z"),
  storage: "database" satisfies StorageKind,
  storage_owner: "krizaka" satisfies CloudOwner,
  retain_until: null,
  collection_id: null,
  folder_id: null,
  text: "",
  content: Buffer.alloc(0),
  object_key: null,
  ...over,
});

const heldStore = (kind: StorageKind, files: Record<string, Uint8Array>, gets: string[] = []): DocumentStore => ({
  put: async () => undefined,
  get: async (key) => {
    gets.push(key);
    return files[key] ? { bytes: files[key], contentType: "application/pdf" } : null;
  },
  signedUrl: async () => null,
  delete: async () => undefined,
  describe: () => ({
    kind,
    endpoint: "e",
    region: null,
    residency: "unknown",
    encrypted: false,
    owner: "workspace",
    devOnly: false,
  }),
});

const noStores: StoresOf = () => null;

beforeEach(() => {
  working.store = null;
});

describe("which store holds a document", () => {
  const row = (storage: string, owner: string) => ({
    owner_id: ACCOUNT,
    storage: storage as StorageKind,
    storage_owner: owner as CloudOwner,
    object_key: "k",
  });

  it("is the owner's cloud for a kept document, asked by whose it is", async () => {
    const asked: string[] = [];
    const theirs = heldStore("s3", {});
    const holder = holderFrom((owner) => {
      asked.push(owner);
      return theirs;
    });
    expect(await holder(row("s3", "workspace"))).toBe(theirs);
    expect(asked).toEqual(["workspace"]);
  });

  it("is the working store for a document that is not kept elsewhere", async () => {
    const mine = heldStore("database", {});
    working.store = mine;
    const holder = holderFrom(() => {
      throw new Error("not asked");
    });
    expect(await holder(row("database", "krizaka"))).toBe(mine);
    expect(await holder(row("none", "krizaka"))).toBe(mine);
  });
});

describe("the export of everything a person has", () => {
  it("is refused for an account that does not exist", async () => {
    const { q } = fakeQuery({ account: [] });
    const error = await exportData(q, ACCOUNT, noStores, NOW).then(
      () => null,
      (e: { status: number; body: { code: string } }) => e,
    );
    expect(error?.status).toBe(404);
    expect(error?.body.code).toBe("NOT_FOUND");
  });

  it("scopes every read to the account", async () => {
    const { q, sent } = fakeQuery({ account: [account()] });
    await exportData(q, ACCOUNT, noStores, NOW);
    expect(sent.length).toBeGreaterThanOrEqual(9);
    expect(sent.every((s) => s.values?.[0] === ACCOUNT)).toBe(true);
  });

  it("states the profile and the billing, with the credits from the ledger", async () => {
    const { q } = fakeQuery({ account: [account()] });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.exportedAt).toBe(NOW.toISOString());
    expect(out.profile).toEqual({
      id: ACCOUNT,
      email: "p@verikora.test",
      name: "Pat",
      locale: "fr",
      perspective: "tenant",
      createdAt: "2026-01-02T03:04:05.000Z",
      termsAcceptedAt: "2026-01-03T00:00:00.000Z",
      privacyAcceptedAt: null,
    });
    expect(out.billing).toEqual({
      plan: "pro",
      auditCredits: 4,
      freeAuditUsed: true,
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-08-01T00:00:00.000Z",
    });
  });

  it("has no dates where the account has none", async () => {
    const { q } = fakeQuery({
      account: [
        account({
          terms_accepted_at: null,
          privacy_accepted_at: null,
          current_period_end: null,
          subscription_status: null,
        }),
      ],
    });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.profile.termsAcceptedAt).toBeNull();
    expect(out.billing.currentPeriodEnd).toBeNull();
    expect(out.billing.subscriptionStatus).toBeNull();
    expect(out.libraries).toEqual([]);
    expect(out.tags).toEqual([]);
    expect(out.documents).toEqual([]);
  });

  it("nests the libraries, their collections and folders, each with its tags", async () => {
    const { q } = fakeQuery({
      account: [account()],
      libraries: [
        { id: "l1", name: "Home" },
        { id: "l2", name: "Empty" },
      ],
      collections: [
        { id: "c1", library_id: "l1", name: "Leases", is_default: true },
        { id: "c2", library_id: "l1", name: "Other", is_default: false },
      ],
      folders: [
        { id: "f1", collection_id: "c1", name: "2026" },
        { id: "f2", collection_id: "c2", name: "Old" },
      ],
      tags: [{ id: "t1", name: "Urgent", color: "red" }],
      collectionTags: [
        { target: "c1", tag: "Urgent" },
        { target: "c1", tag: "Home" },
      ],
      folderTags: [{ target: "f1", tag: "Urgent" }],
    });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.tags).toEqual([{ id: "t1", name: "Urgent", color: "red" }]);
    expect(out.libraries).toEqual([
      {
        id: "l1",
        name: "Home",
        collections: [
          {
            id: "c1",
            name: "Leases",
            isDefault: true,
            tags: ["Urgent", "Home"],
            folders: [{ id: "f1", name: "2026", tags: ["Urgent"] }],
          },
          { id: "c2", name: "Other", isDefault: false, tags: [], folders: [{ id: "f2", name: "Old", tags: [] }] },
        ],
      },
      { id: "l2", name: "Empty", collections: [] },
    ]);
  });

  it("lists each document with its workspace tags, its text, and only its own analyses", async () => {
    const { q } = fakeQuery({
      account: [account()],
      documents: [
        doc("d1", {
          text: "Bail de logement",
          collection_id: "c1",
          folder_id: "f1",
          retain_until: new Date("2027-01-01T00:00:00Z"),
        }),
        doc("d2"),
      ],
      documentTags: [
        { target: "d1", tag: "Lease" },
        { target: "d1", tag: "2026" },
      ],
      analyses: [
        {
          id: "a1",
          document_id: "d1",
          studio: "compliance-check",
          status: "succeeded",
          run_id: "run-1",
          created_at: new Date("2026-03-01T00:00:00Z"),
          report: { findings: [] },
        },
        {
          id: "a2",
          document_id: "other",
          studio: "authenticity",
          status: "failed",
          run_id: null,
          created_at: new Date("2026-03-02T00:00:00Z"),
          report: null,
        },
      ],
    });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.documents.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(out.documents[0]).toMatchObject({
      title: "Title d1",
      filename: "d1.pdf",
      mimeType: "application/pdf",
      kind: "lease",
      sizeBytes: 3,
      pages: 2,
      createdAt: "2026-02-01T00:00:00.000Z",
      storage: "database",
      retainUntil: "2027-01-01T00:00:00.000Z",
      collectionId: "c1",
      folderId: "f1",
      tags: ["Lease", "2026"],
      text: "Bail de logement",
      analyses: [
        {
          id: "a1",
          studio: "compliance-check",
          status: "succeeded",
          runId: "run-1",
          createdAt: "2026-03-01T00:00:00.000Z",
          report: { findings: [] },
        },
      ],
    });
    expect(out.documents[1]).toMatchObject({ text: null, tags: [], analyses: [], retainUntil: null });
  });
});

describe("the kept file of a document", () => {
  it("is the bytes in the database row, as base64, or null when the row holds none", async () => {
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("with", { content: Buffer.from("hello") }), doc("without")],
    });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.documents[0]?.file).toEqual({
      contentType: "application/pdf",
      base64: Buffer.from("hello").toString("base64"),
    });
    expect(out.documents[1]?.file).toBeNull();
  });

  it("is read by its key from the store that holds it", async () => {
    const gets: string[] = [];
    const theirs = heldStore("s3", { "k/1.pdf": new TextEncoder().encode("from the cloud") }, gets);
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "s3", storage_owner: "workspace", object_key: "k/1.pdf" })],
    });
    const out = await exportData(q, ACCOUNT, () => theirs, NOW);
    expect(gets).toEqual(["k/1.pdf"]);
    expect(out.documents[0]?.file).toEqual({
      contentType: "application/pdf",
      base64: Buffer.from("from the cloud").toString("base64"),
    });
  });

  it("is read from the working store when the document is not kept elsewhere", async () => {
    working.store = heldStore("database", { "w/1.pdf": new TextEncoder().encode("waiting") });
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "none", object_key: "w/1.pdf" })],
    });
    const out = await exportData(q, ACCOUNT, noStores, NOW);
    expect(out.documents[0]?.file?.base64).toBe(Buffer.from("waiting").toString("base64"));
  });

  it("is null when the store has no such object, or there is no store to ask", async () => {
    const empty = heldStore("s3", {});
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "s3", storage_owner: "workspace", object_key: "gone.pdf" })],
    });
    expect((await exportData(q, ACCOUNT, () => empty, NOW)).documents[0]?.file).toBeNull();
    expect((await exportData(q, ACCOUNT, noStores, NOW)).documents[0]?.file).toBeNull();
  });

  it("says nothing of a file in a cloud the person disconnected, instead of failing the whole export", async () => {
    const disconnected: DocumentStore = {
      ...heldStore("cloud", {}),
      get: async () => {
        throw Object.assign(new Error("disconnected"), { body: { code: "STORAGE_DISCONNECTED" } });
      },
    };
    const { q } = fakeQuery({
      account: [account()],
      documents: [
        doc("d1", { storage: "cloud", storage_owner: "workspace", object_key: "k/1.pdf" }),
        doc("d2", { content: Buffer.from("db") }),
      ],
    });
    const out = await exportData(q, ACCOUNT, () => disconnected, NOW);
    expect(out.documents[0]?.file).toBeNull();
    expect(out.documents[1]?.file?.base64).toBe(Buffer.from("db").toString("base64"));
  });

  it("fails the export for any other read failure, rather than leave a file out silently", async () => {
    const broken: DocumentStore = {
      ...heldStore("s3", {}),
      get: async () => {
        throw new Error("network down");
      },
    };
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "s3", storage_owner: "workspace", object_key: "k/1.pdf" })],
    });
    await expect(exportData(q, ACCOUNT, () => broken, NOW)).rejects.toThrow("network down");
  });

  it("is found by the legacy key (owner, document, extension) for a kept document without an object key", async () => {
    const gets: string[] = [];
    const theirs = heldStore("s3", { [`${ACCOUNT}/d1/original.pdf`]: new TextEncoder().encode("legacy") }, gets);
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "s3", storage_owner: "workspace" })],
    });
    const out = await exportData(q, ACCOUNT, () => theirs, NOW);
    expect(gets).toEqual([`${ACCOUNT}/d1/original.pdf`]);
    expect(out.documents[0]?.file?.base64).toBe(Buffer.from("legacy").toString("base64"));
  });

  it("is not read from a store of another kind than the one the row names, and falls back to the row's bytes", async () => {
    const other = heldStore("bunny", { [`${ACCOUNT}/d1/original.pdf`]: new TextEncoder().encode("wrong") });
    const { q } = fakeQuery({
      account: [account()],
      documents: [doc("d1", { storage: "s3", storage_owner: "workspace", content: Buffer.from("row") })],
    });
    const out = await exportData(q, ACCOUNT, () => other, NOW);
    expect(out.documents[0]?.file?.base64).toBe(Buffer.from("row").toString("base64"));
  });
});
