import { audit } from "./audit";
import { query } from "./db";
import { refuse } from "./http";
import { GATE_STATUS } from "./screening-checks/gate";

/** Marks a blocker done (with the date and the reference of its evidence) or reopens it. Audited. */
export async function setBlocker(actor: { id: string; email: string }, input: { blocker: string; status: "open" } | { blocker: string; status: "done"; evidenceOn: string; evidenceRef: string }, headers?: Headers): Promise<void> {
  const done = input.status === GATE_STATUS.done;
  const rows = await query<{ blocker: string }>(
    "UPDATE compliance_gate SET status = $2, evidence_on = $3, evidence_ref = $4 WHERE blocker = $1 RETURNING blocker",
    [input.blocker, input.status, done ? input.evidenceOn : null, done ? input.evidenceRef : null],
  );
  if (rows.length === 0) throw refuse(404, "NOT_FOUND", "No such blocker");
  await audit({ action: "compliance_gate.updated", actorId: actor.id, actorLabel: actor.email, targetId: null, detail: { blocker: input.blocker, status: input.status, ...(done ? { evidenceOn: input.evidenceOn } : {}) }, headers });
}
