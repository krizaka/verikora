import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../settings/boundary";

type Call = { text: string; values: unknown[] };
interface Entitlement {
  pro: boolean;
  credits: number;
  freeAuditUsed: boolean;
}
interface ReuseLookup {
  reuseDays: number;
  now: Date;
  ownerId: string;
  documentId: string;
  studio: string;
  jurisdiction: string | null;
  ruleset: string | null;
  expectedIssuer: string | null;
}

const world: {
  calls: Call[];
  known: Record<string, { id: string }>;
  entitlement: Entitlement;
  reusable: (lookup: ReuseLookup) => boolean;
  lookups: ReuseLookup[];
  inspected: { name: string; type: string; size: number }[];
  refuse: (name: string) => unknown;
} = {
  calls: [],
  known: {},
  entitlement: { pro: false, credits: 0, freeAuditUsed: false },
  reusable: () => false,
  lookups: [],
  inspected: [],
  refuse: () => null,
};

vi.mock("../db", () => ({
  query: async (text: string, values: unknown[] = []) => {
    world.calls.push({ text, values });
    const hit = world.known[String(values[1])];
    return hit ? [hit] : [];
  },
}));
vi.mock("../billing", () => ({ entitlementOf: async () => world.entitlement }));
vi.mock("../documents", () => ({
  inspectUpload: async (file: { name: string; type: string; size: number }, bytes: Uint8Array) => {
    world.inspected.push(file);
    const failure = world.refuse(file.name);
    if (failure) {
      throw failure;
    }
    return { sha256: `sha-${new TextDecoder().decode(bytes)}` };
  },
}));
vi.mock("../preflight-events", () => ({
  findReusableAnalysis: async (_q: unknown, lookup: ReuseLookup) => {
    world.lookups.push(lookup);
    return world.reusable(lookup) ? { id: "an-1" } : null;
  },
}));
vi.mock("../settings/boundary", () => ({ preflightRulesFrom: () => ({}) }));

import { HttpError, refuse } from "../http";
import { type BatchFile, previewBatch } from "./preview";

const NOW = new Date("2026-11-15T10:00:00Z");
const settings = (over: { maxRows?: number; freeFirst?: boolean } = {}) =>
  ({
    "limits.batchMaxRows": { value: over.maxRows ?? 200 },
    "audit.freeFirst": { value: over.freeFirst ?? true },
    "limits.reuseDays": { value: 30 },
  }) as unknown as Snapshot;

const file = (name: string, content = name): BatchFile => ({
  name,
  type: "application/pdf",
  bytes: new TextEncoder().encode(content),
});

beforeEach(() => {
  world.calls = [];
  world.known = {};
  world.entitlement = { pro: false, credits: 0, freeAuditUsed: false };
  world.reusable = () => false;
  world.lookups = [];
  world.inspected = [];
  world.refuse = () => null;
});

describe("previewing a batch before anything runs", () => {
  it("refuses a batch over the workspace's row limit, naming the limit", async () => {
    const manifest = ["file,check", "a.pdf,compliance", "b.pdf,compliance", "c.pdf,compliance"].join("\n");
    const error = await previewBatch("o", manifest, [], settings({ maxRows: 2 }), NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 413, body: { code: "BATCH_TOO_LARGE", limit: 2 } });
  });

  it("marks a row for check, keeps its reference and studio, and reports the files nobody named", async () => {
    const preview = await previewBatch(
      "o",
      "file,check,reference\nbail.pdf,compliance,LOC-1",
      [file("bail.pdf"), file("extra.pdf")],
      settings(),
      NOW,
    );
    expect(preview.rows).toEqual([
      { line: 2, file: "bail.pdf", studio: "compliance-check", state: "check", errors: [], reference: "LOC-1" },
    ]);
    expect(preview.unnamedFiles).toEqual(["extra.pdf"]);
    expect(preview.counts).toEqual({ check: 1, reuse: 0, refused: 0 });
  });

  it("matches a file to its row whatever the letter case, and runs the pre-flight on its real size", async () => {
    await previewBatch("o", "file,check\nBAIL.PDF,compliance", [file("bail.pdf", "12345")], settings(), NOW);
    expect(world.inspected).toEqual([{ name: "bail.pdf", type: "application/pdf", size: 5 }]);
  });

  it("refuses a row whose file was not sent, and a row the manifest already refused, without any lookup", async () => {
    const preview = await previewBatch(
      "o",
      "file,check\nabsent.pdf,compliance\nbail.pdf,nonsense",
      [file("bail.pdf")],
      settings(),
      NOW,
    );
    expect(preview.rows.map((r) => [r.line, r.state, r.errors])).toEqual([
      [2, "refused", ["FILE_NOT_SENT"]],
      [3, "refused", ["UNKNOWN_CHECK"]],
    ]);
    expect(world.inspected).toEqual([]);
    expect(world.calls).toEqual([]);
    expect(preview.counts).toEqual({ check: 0, reuse: 0, refused: 2 });
  });

  it("gives the pre-flight's own code for a file it refuses, and REFUSED for any other failure", async () => {
    world.refuse = (name) =>
      name === "trap.pdf" ? refuse(422, "FILE_ACTIVE_CONTENT", "no") : name === "odd.pdf" ? new Error("boom") : null;
    const preview = await previewBatch(
      "o",
      "file,check\ntrap.pdf,compliance\nodd.pdf,compliance\nfine.pdf,compliance",
      [file("trap.pdf"), file("odd.pdf"), file("fine.pdf")],
      settings(),
      NOW,
    );
    expect(preview.rows.map((r) => [r.state, r.errors])).toEqual([
      ["refused", ["FILE_ACTIVE_CONTENT"]],
      ["refused", ["REFUSED"]],
      ["check", []],
    ]);
  });

  it("reuses the result of a file already known when one still holds under the same rules, spending no audit", async () => {
    world.known = { "sha-bail.pdf": { id: "doc-9" } };
    world.reusable = () => true;
    const preview = await previewBatch(
      "owner-1",
      "file,check\nbail.pdf,compliance",
      [file("bail.pdf")],
      settings(),
      NOW,
    );
    expect(preview.rows[0]).toMatchObject({ state: "reuse", errors: [] });
    expect(preview.cost.audits).toBe(0);
    expect(world.calls[0]!.values).toEqual(["owner-1", "sha-bail.pdf"]);
    expect(world.lookups[0]).toMatchObject({
      reuseDays: 30,
      now: NOW,
      ownerId: "owner-1",
      documentId: "doc-9",
      studio: "compliance-check",
      expectedIssuer: null,
    });
  });

  it("passes the authenticity row's expected issuer and no jurisdiction to the reuse rule", async () => {
    world.known = { "sha-bail.pdf": { id: "doc-9" } };
    await previewBatch(
      "o",
      "file,check,expectedIssuer\nbail.pdf,authenticity,Desjardins",
      [file("bail.pdf")],
      settings(),
      NOW,
    );
    expect(world.lookups[0]).toMatchObject({
      studio: "document-authenticity",
      jurisdiction: null,
      ruleset: null,
      expectedIssuer: "Desjardins",
    });
  });

  it("checks a known file when no earlier result can be reused", async () => {
    world.known = { "sha-bail.pdf": { id: "doc-9" } };
    const preview = await previewBatch("o", "file,check\nbail.pdf,compliance", [file("bail.pdf")], settings(), NOW);
    expect(preview.rows[0]!.state).toBe("check");
    expect(world.lookups).toHaveLength(1);
  });

  it("does not look for a reusable result for a file never seen", async () => {
    await previewBatch("o", "file,check\nbail.pdf,compliance", [file("bail.pdf")], settings(), NOW);
    expect(world.lookups).toEqual([]);
  });
});

describe("what the audits cost against what the account has", () => {
  const manifest = "file,check\na.pdf,compliance\nb.pdf,compliance";
  const files = [file("a.pdf"), file("b.pdf")];
  const cost = async (entitlement: Entitlement, freeFirst = true) => {
    world.entitlement = entitlement;
    return (await previewBatch("o", manifest, files, settings({ freeFirst }), NOW)).cost;
  };

  it("is not covered for two files with only the free first audit", async () => {
    expect(await cost({ pro: false, credits: 0, freeAuditUsed: false })).toEqual({
      audits: 2,
      covered: false,
      credits: 0,
      pro: false,
    });
  });
  it("counts the free first audit with one credit as covering two", async () => {
    expect((await cost({ pro: false, credits: 1, freeAuditUsed: false })).covered).toBe(true);
  });
  it("does not count the free audit once it is used, or when the setting is off", async () => {
    expect((await cost({ pro: false, credits: 1, freeAuditUsed: true })).covered).toBe(false);
    expect((await cost({ pro: false, credits: 1, freeAuditUsed: false }, false)).covered).toBe(false);
  });
  it("is always covered on Pro", async () => {
    expect(await cost({ pro: true, credits: 0, freeAuditUsed: true })).toMatchObject({ covered: true, pro: true });
  });
});
