import { diffSnapshot, type SchemaSnapshot } from "./schema-check";

export interface DriftReport {
  drifted: boolean;
  /** One line for the job's log: « no drift » or « drift: » and the problems. */
  line: string;
}

/** The live schema against the expected one, as the nightly dev job prints it (krizaka-internal#4881). */
export function driftReport(expected: SchemaSnapshot, actual: SchemaSnapshot): DriftReport {
  const problems = diffSnapshot(expected, actual);
  return problems.length
    ? { drifted: true, line: `drift: ${problems.join("; ")}` }
    : { drifted: false, line: "no drift" };
}
