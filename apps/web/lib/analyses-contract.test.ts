import { beforeEach, describe, expect, it, vi } from "vitest";

import tenant from "../content/recorded-runs/tenant.json";

type Loose = { summary?: { blockingFailures: number }; facts?: unknown; findings: Record<string, unknown>[] } & Record<
  string,
  unknown
>;

const state = vi.hoisted(() => ({
  text: "",
  updates: [] as unknown[][],
  refunds: [] as string[],
  run: { outputs: [] as { key: string; type: string; value: string }[] },
}));

vi.mock("@/app/active-store", () => ({ holderOf: {} }));
vi.mock("../app/overage-biller", () => ({ overageBiller: () => null }));
vi.mock("../app/system-clock", () => ({ systemClock: { now: () => new Date("2026-11-13T12:00:00Z") } }));
vi.mock("./retention", () => ({ purgeIfDone: async () => undefined }));
vi.mock("./rules/tenant-shield-report", () => ({ withTenantShield: async (r: unknown) => r }));
vi.mock("./settings/instance", () => ({ appSettings: () => ({}) }));
vi.mock("./refused-words", () => ({ refusedWords: async () => ["fraud", "liar", "reject"] }));
vi.mock("./billing", () => ({
  refundFailedAudit: async (_q: unknown, id: string) => {
    state.refunds.push(id);
    return true;
  },
}));
vi.mock("./sovkora", () => ({
  sovkora: () => ({
    getRun: async () => ({ id: "r1", status: "SUCCEEDED", outputs: state.run.outputs, finishedAt: null }),
  }),
}));
vi.mock("./db", () => ({
  query: async (text: string, values: unknown[] = []) => {
    if (text.startsWith("SELECT text FROM documents")) {
      return [{ text: state.text }];
    }
    if (text.startsWith("UPDATE analyses")) {
      state.updates.push(values);
      return [
        {
          id: values[0],
          document_id: "d1",
          studio: "compliance-check",
          status: values[1],
          run_id: "r1",
          blueprint_version: null,
          inputs: {},
          report: values[2] ? JSON.parse(values[2] as string) : null,
          error: values[3],
          created_at: new Date(),
          finished_at: null,
        },
      ];
    }
    return [];
  },
}));

const { refresh } = await import("./analyses");

const recording = tenant as unknown as { document: { text: string }; run: typeof state.run & { status: string } };
const report = (edit?: (r: Loose) => void) => {
  const r = JSON.parse(recording.run.outputs.find((o) => o.key === "report")!.value!);
  edit?.(r);
  return [{ key: "report", type: "json", value: JSON.stringify(r) }];
};
const row = { id: "a1", document_id: "d1", studio: "compliance-check", status: "running", run_id: "r1" } as never;

beforeEach(() => {
  state.text = recording.document.text;
  state.updates = [];
  state.refunds = [];
});

describe("a report is a page only if it passes the contract, at the read of the run", () => {
  it("keeps a valid output as a report and refunds nothing", async () => {
    state.run.outputs = report();
    const a = await refresh(row);
    expect(a.status).toBe("succeeded");
    expect(a.report).not.toBeNull();
    expect(a.error).toBeNull();
    expect(state.refunds).toEqual([]);
  });
  it.each([
    ["REPORT_SCHEMA", (r: Loose) => void delete r.summary],
    ["REPORT_CITATION", (r: Loose) => void (r.findings[0]!.evidenceSpan = { quote: "nothing like this in the lease" })],
    ["REPORT_WORDING", (r: Loose) => void (r.findings[0]!.explanation = "The tenant is a liar.")],
  ])("%s: a coded failure with no report, and the credit comes back once", async (code, edit) => {
    state.run.outputs = report(edit);
    const a = await refresh(row);
    expect(a.status).toBe("failed");
    expect(a.report).toBeNull();
    expect(a.error).toMatch(new RegExp(`^${code}\\b`));
    expect(state.updates[0]![2]).toBeNull();
    expect(state.refunds).toEqual(["a1"]);
  });
});
