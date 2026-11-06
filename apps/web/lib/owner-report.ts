import {
  type Analysis,
  analysisStatus,
  type AuthenticityReport,
  type ComplianceReport,
  type Signal,
  signalFamily,
} from "@verikora/core";

import type { ApplicantFileView } from "./applicant-file";

/**
 * The verification report an owner reads (verikora#128), pure: what is kept of an applicant file, and what is dropped.
 * Kept: a reference, the date, per document its type, hash and page count, the signals observed, the rule, verdict and article
 * of each finding, the runs and versions. Dropped: the candidate's name and e-mail, the file names (they carry names), every
 * quoted passage, the document text and images. It never scores, ranks or decides: the signals are observations.
 */
// @fixed: the default life of an owner link; the manager picks the days of each link, kept on its row
export const SHARE_DEFAULT_DAYS = 7;
// @fixed: the longest life of an owner link (short retention, Loi 25)
export const SHARE_MAX_DAYS = 30;

export interface OwnerSignal {
  id: string;
  level: string;
  observation: string;
  /** The family and where in the file (page, later save, field): facts, never a value of the document. The box stays in the person's own report. */
  family?: string;
  evidence?: { page?: number; revision?: number; field?: string };
  /** The applicant's own explanation of this trace and its date (ADR-0014, verikora#626), shown next to it. */
  answer?: { text: string; at: string };
}
export interface OwnerFinding {
  ruleId: string;
  verdict: string;
  severity: string;
  citation: string | null;
}
export interface OwnerRun {
  studio: string;
  runId: string;
  studioVersion: string | null;
  finishedAt: string | null;
}
export interface OwnerDocument {
  typeId: string | null;
  sha256: string;
  pages: number | null;
  signals: OwnerSignal[];
  findings: OwnerFinding[];
  notExamined: string[];
  runs: OwnerRun[];
}
export interface OwnerRuleset {
  jurisdiction: string;
  rulesetId: string;
  rulesetVersion: string;
  reviewStatus: string | null;
}
export interface OwnerReport {
  reference: string;
  issuedAt: string;
  documents: OwnerDocument[];
  rulesets: OwnerRuleset[];
}

const isCompliance = (r: Analysis["report"]): r is ComplianceReport => !!r && "findings" in r;
const isAuthenticity = (r: Analysis["report"]): r is AuthenticityReport => !!r && "signals" in r;

/** A signal as the owner reads it: its family and the page, revision and field it concerns (no box, no value). */
export const ownerSignalOf = (s: Signal): OwnerSignal => {
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

/** The reference the owner and the manager both read: the first 8 characters of the file's id, no personal data. */
export const referenceOf = (fileId: string) => fileId.replaceAll("-", "").slice(0, 8).toUpperCase();

/** Pure: the redacted report of an applicant file. `hashes` maps a document id to its SHA-256 (kept after the file is purged). */
export function ownerReportOf(
  file: ApplicantFileView,
  hashes: ReadonlyMap<string, string>,
  issuedAt: Date,
): OwnerReport {
  const rulesets = new Map<string, OwnerRuleset>();
  const documents: OwnerDocument[] = file.documents.flatMap((d) => {
    const sha256 = hashes.get(d.id);
    if (!sha256) {
      return [];
    }
    const done = d.checks.filter((c) => c.status === analysisStatus.enum.succeeded && c.runId && !c.inputs.seeded);
    const doc: OwnerDocument = {
      typeId: d.typeId,
      sha256,
      pages: d.pages,
      signals: [],
      findings: [],
      notExamined: [],
      runs: [],
    };
    for (const c of done) {
      doc.runs.push({ studio: c.studio, runId: c.runId!, studioVersion: c.blueprintVersion, finishedAt: c.finishedAt });
      if (isAuthenticity(c.report)) {
        doc.signals.push(
          ...c.report.signals.map((s) => ({
            ...ownerSignalOf(s),
            ...(d.answers[s.signalId] ? { answer: d.answers[s.signalId] } : {}),
          })),
        );
        const ne = c.report.notExamined;
        doc.notExamined.push(...asList(ne));
      } else if (isCompliance(c.report)) {
        doc.findings.push(
          ...c.report.findings.map((f) => ({
            ruleId: f.ruleId,
            verdict: f.verdict,
            severity: f.severity,
            citation: f.citation ?? null,
          })),
        );
        rulesets.set(`${c.report.rulesetId}@${c.report.rulesetVersion}`, {
          jurisdiction: c.report.jurisdiction,
          rulesetId: c.report.rulesetId,
          rulesetVersion: c.report.rulesetVersion,
          reviewStatus: c.report.reviewStatus ?? null,
        });
      }
    }
    return [doc];
  });
  return {
    reference: referenceOf(file.id),
    issuedAt: issuedAt.toISOString(),
    documents,
    rulesets: [...rulesets.values()],
  };
}

/** Nothing, one value or a list → a list. */
const asList = <T>(v: T | T[] | null | undefined): T[] => {
  if (Array.isArray(v)) {
    return v;
  }
  return v ? [v] : [];
};

/** A share's state as of now. Pure. */
export type ShareState = "live" | "expired" | "revoked";
export const shareState = (s: { expiresAt: Date; revokedAt: Date | null }, now: Date): ShareState => {
  if (s.revokedAt) {
    return "revoked";
  }
  return s.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
};

/** Days asked → days kept: a number in 1..SHARE_MAX_DAYS, the default otherwise. */
export const shareDays = (asked: number | undefined) =>
  asked && Number.isInteger(asked) && asked >= 1 && asked <= SHARE_MAX_DAYS ? asked : SHARE_DEFAULT_DAYS;
