import { query } from "../db";
import { appSettings } from "../settings/instance";

/*
 * The compliance gate (yomizaka#135): no live resale of a screening check until every blocker is done, with the date of its
 * evidence. It is a hard check in three places: a pure rule (tested), a runtime guard on every non-demo adapter, and the boot
 * (`assertLiveGate`: the server does not start with features.screeningLive on while a blocker is open). Live mode is Oussama's switch;
 * nothing here turns it on.
 */
export interface GateRow {
  blocker: string;
  required_live: boolean;
  status: "open" | "done";
  evidence_on: Date | string | null;
  evidence_ref: string | null;
}
export interface GateState {
  /** The live flag AND every required blocker done with evidence. */
  open: boolean;
  /** The required blockers still open (or done without a date and a reference). */
  blockers: string[];
}

export const GATE_STATUS = { open: "open", done: "done" } as const;
const hasEvidence = (r: GateRow) => r.status === GATE_STATUS.done && !!r.evidence_on && !!r.evidence_ref?.trim();

/** Pure: is live mode allowed? The flag must be on and no required blocker may be missing its evidence. */
export function gateState(liveFlag: boolean, rows: readonly GateRow[]): GateState {
  const blockers = rows.filter((r) => r.required_live && !hasEvidence(r)).map((r) => r.blocker);
  return { open: liveFlag && blockers.length === 0 && rows.some((r) => r.required_live), blockers };
}

/** Pure: may a check type that needs a lawyer's confirmation (`requires_lawyer`) be offered? Only if that blocker is done with evidence. */
export function lawyerCleared(blocker: string | null, rows: readonly GateRow[]): boolean {
  if (!blocker) return true;
  const row = rows.find((r) => r.blocker === blocker);
  return !!row && hasEvidence(row);
}

export const loadGate = () => query<GateRow>("SELECT blocker, required_live, status, evidence_on, evidence_ref FROM compliance_gate ORDER BY blocker");

/** Oussama's switch (`features.screeningLive`, a setting, off by default). */
export const liveFlag = async (): Promise<boolean> => (await appSettings().get("features.screeningLive")) === true;

export async function liveGate(): Promise<GateState> {
  return gateState(await liveFlag(), await loadGate());
}

/** Boot guard: live mode refuses to start while any blocker is open. Off, it is silent. */
export async function assertLiveGate(): Promise<void> {
  if (!(await liveFlag())) return;
  const state = gateState(true, await loadGate());
  if (!state.open) throw new Error(`features.screeningLive is on but the compliance gate is closed: ${state.blockers.join(", ") || "no blocker declared"}`);
}
