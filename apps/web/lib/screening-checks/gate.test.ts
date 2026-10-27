import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SETTINGS } from "../settings/registry";
import { type GateRow, gateState, lawyerCleared } from "./gate";
import { closedDoor, engineProvider, NOT_CONFIGURED } from "./providers";

const row = (blocker: string, over: Partial<GateRow> = {}): GateRow => ({ blocker, required_live: true, status: "open", evidence_on: null, evidence_ref: null, ...over });
const done = (blocker: string, over: Partial<GateRow> = {}) => row(blocker, { status: "done", evidence_on: "2026-11-02", evidence_ref: "signed PDF, folder X", ...over });
const call = { userId: "u", runId: "r", subject: { subjectId: "s", firstName: "A", lastName: "B" }, region: "QC" };

describe("the compliance gate — live mode refuses to start while any blocker is open (yomizaka#135)", () => {
  const all = ["reseller-agreements", "lawyer-credit-for-rental", "efvp", "consent-text", "provider-residency", "adverse-action-wording"];
  it("is closed while any required blocker is open, naming it", () => {
    const rows = all.map((b, n) => (n === 2 ? row(b) : done(b)));
    expect(gateState(true, rows)).toEqual({ open: false, blockers: ["efvp"] });
  });
  it("is closed when a blocker is « done » without its date or its reference", () => {
    expect(gateState(true, [done("a", { evidence_on: null })]).open).toBe(false);
    expect(gateState(true, [done("a", { evidence_ref: "  " })]).open).toBe(false);
  });
  it("opens only when the flag is on AND every required blocker is done with evidence", () => {
    const rows = all.map((b) => done(b));
    expect(gateState(true, rows)).toEqual({ open: true, blockers: [] });
    expect(gateState(false, rows).open).toBe(false);
  });
  it("is closed with no blocker declared at all", () => {
    expect(gateState(true, []).open).toBe(false);
  });
  it("does not wait for a blocker that is not required for live (the criminal-record one)", () => {
    expect(gateState(true, [done("a"), row("criminal-records-lawful", { required_live: false })]).open).toBe(true);
  });
  it("a type that needs a lawyer is offered only once that blocker is done with evidence", () => {
    expect(lawyerCleared(null, [])).toBe(true);
    expect(lawyerCleared("criminal-records-lawful", [row("criminal-records-lawful", { required_live: false })])).toBe(false);
    expect(lawyerCleared("criminal-records-lawful", [done("criminal-records-lawful", { required_live: false })])).toBe(true);
    expect(lawyerCleared("unknown", [])).toBe(false);
  });
});

describe("the runtime guard on a live adapter", () => {
  it("never reaches the door while the gate is closed, whatever the door is", async () => {
    let reached = 0;
    const door = { submit: async () => (reached++, { ...NOT_CONFIGURED, outcome: "NO_MATCH" as const }), collect: async () => (reached++, NOT_CONFIGURED) };
    const guarded = engineProvider(door, async () => false);
    expect(await guarded.submit("CREDIT", call)).toEqual(NOT_CONFIGURED);
    expect(await guarded.collect("CREDIT", call, "ref")).toEqual(NOT_CONFIGURED);
    expect(reached).toBe(0);
    expect((await engineProvider(door, async () => true).submit("CREDIT", call)).outcome).toBe("NO_MATCH");
    expect(reached).toBe(1);
  });
  it("the default guard reads the gate: no live call without it", () => {
    const source = readFileSync(join(__dirname, "providers.ts"), "utf8");
    expect(source).toContain("liveGate()");
    expect(engineProvider(closedDoor).demo).toBe(false);
  });
});

describe("the live flag is a setting, off by default", () => {
  it("features.screeningLive is declared and OFF", () => {
    expect(SETTINGS["features.screeningLive"].default).toBe(false);
  });
});
