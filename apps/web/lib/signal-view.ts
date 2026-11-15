import { type Signal, type SignalFamily, signalFamily } from "@verikora/core";

/** A trace as a person reads it: its family and the page, revision and field it concerns (no box, no value). */
export interface SignalView {
  id: string;
  level: string;
  observation: string;
  family: SignalFamily;
  evidence?: { page?: number; revision?: number; field?: string };
}

export const signalViewOf = (s: Signal): SignalView => {
  const { page, revision, field } = s.evidence ?? {};
  const evidence = { ...(page ? { page } : {}), ...(revision ? { revision } : {}), ...(field ? { field } : {}) };
  return {
    id: s.signalId,
    level: s.level,
    observation: s.observation,
    family: signalFamily(s),
    ...(Object.keys(evidence).length ? { evidence } : {}),
  };
};
