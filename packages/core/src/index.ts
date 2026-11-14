import { z } from "zod";

import { extractionStatus } from "./extraction";
import { DOCUMENT_KINDS, DOCUMENT_STATUSES } from "./vocabulary";

export {
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DOCUMENT_TABS,
  type DocumentTab,
  movedDocumentTab,
  OLD_DOCUMENT_TABS,
} from "./vocabulary";

/*
 * Verikora's contracts — what the API answers and the web reads, validated on both sides. Structure only: the words are
 * messages (apps/web/messages). Every analysis is an Sovkora run: these schemas describe what Verikora keeps of it (the
 * run id, its status, the report Sovkora returned), never a verdict of its own.
 */

/** The largest file Verikora keeps (the MVP stores files in its own database). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** The largest file Sovkora's authenticity Studio reads (its input is the file in base64, ≤ 7 000 000 characters since document-authenticity 1.3.0). */
export const AUTHENTICITY_MAX_BYTES = 5_000_000;
/** The longest text Sovkora's compliance Studio reads (its `document` input). */
export const COMPLIANCE_MAX_CHARS = 60_000;
/** What can be uploaded: a PDF (its text layer is read) or plain text. */
/** A Word file (.docx), accepted since verikora#229: its text is read for the checks, the file itself is examined for authenticity. */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const ODT_MIME = "application/vnd.oasis.opendocument.text";
export const ACCEPTED_TYPES = ["application/pdf", "text/plain", DOCX_MIME, ODT_MIME] as const;
export const acceptedType = z.enum(ACCEPTED_TYPES);
export type AcceptedType = z.infer<typeof acceptedType>;

export const documentKind = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof documentKind>;

/**
 * Which side of the lease a person is on: the tenant (locataire) checks a lease before signing, the landlord (locateur,
 * « propriétaire » in everyday words) checks a template and the tenant's papers. It changes the defaults and the wording,
 * never the rules: both sides run the same Sovkora Studios on the same rulesets.
 */
export const PERSPECTIVES = ["tenant", "landlord"] as const;
export const perspective = z.enum(PERSPECTIVES);
export type Perspective = z.infer<typeof perspective>;

/**
 * Who the person is, for the product: the audiences of « Pour qui ? ». `available` ones have rules that run today; `soon`
 * ones are offered honestly as « bientôt » — never a claimed check that does not run (docs/product/direction-2026-10.md).
 */
export const AUDIENCES = ["tenant", "landlord", "freelancer", "business"] as const;
export const audience = z.enum(AUDIENCES);
export type Audience = z.infer<typeof audience>;
export const AUDIENCE_STATUS = {
  tenant: "available",
  landlord: "available",
  freelancer: "available",
  business: "available",
} as const satisfies Record<Audience, "available" | "soon">;

/**
 * A flow is data administered in the database (ADR-0003): who it is offered to, the Sovkora Studio and the rulesets of each
 * step, the consents it requires, the providers it uses, its price. The app only reads it.
 */
export const FLOW_ENVIRONMENTS = ["dev", "prod"] as const;
export const flowEnvironment = z.enum(FLOW_ENVIRONMENTS);
export type FlowEnvironment = z.infer<typeof flowEnvironment>;
export const FLOW_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export const flowVersionStatus = z.enum(FLOW_VERSION_STATUSES);
export type FlowVersionStatus = z.infer<typeof flowVersionStatus>;
/** Named values, so no code compares a field to a magic string. */
export const VERSION_STATUS = { draft: "draft", published: "published", retired: "retired" } as const satisfies Record<
  FlowVersionStatus,
  FlowVersionStatus
>;
export const FLOW_STATUS = { available: "available", soon: "soon" } as const;
export const STEP_KIND = { studio: "studio", provider: "provider" } as const;

const localised = z.object({ en: z.string().trim().min(1).max(300), fr: z.string().trim().min(1).max(300) });
export const flowStep = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  /** `studio`: an Sovkora Studio of a pack. `provider`: an external provider (a credit bureau…). */
  kind: z.enum(["studio", "provider"]),
  studio: z.enum(["compliance-check", "document-authenticity"]).optional(),
  pack: z.string().max(60).optional(),
  /** The rulesets of the compliance Studio, by jurisdiction — data of the pack, never code here. */
  jurisdictions: z
    .array(z.object({ code: z.enum(["QC", "FR", "BE-WAL"]), ruleset: z.string().min(1).max(80) }))
    .max(10)
    .default([]),
  provider: z.string().max(60).optional(),
});
export type FlowStep = z.infer<typeof flowStep>;
export const flowDefinition = z.object({
  title: localised,
  lead: localised,
  status: z.enum(["available", "soon"]),
  audiences: z.array(z.enum(["tenant", "landlord", "freelancer", "business"])).min(1),
  steps: z.array(flowStep).max(12),
  consents: z
    .array(z.string().regex(/^[a-z0-9-]{1,40}$/))
    .max(8)
    .default([]),
  providers: z.array(z.string().max(60)).max(8).default([]),
  pricing: z
    .object({
      model: z.enum(["free", "per-run", "subscription"]),
      amountCents: z.number().int().min(0).max(1_000_000).optional(),
    })
    .default({ model: "free" }),
});
export type FlowDefinition = z.infer<typeof flowDefinition>;

/** What flows offer on a document: the Studios and, for the compliance Studio, the jurisdictions (with their rulesets). A « soon » flow offers the steps that run today. */
export function offerOf(definitions: readonly FlowDefinition[]): {
  studios: Studio[];
  jurisdictions: Jurisdiction[];
  rulesets: string[];
} {
  const studios = new Set<Studio>();
  const jurisdictions = new Set<Jurisdiction>();
  const rulesets = new Set<string>();
  for (const d of definitions) {
    for (const s of d.steps) {
      if (s.kind !== STEP_KIND.studio || !s.studio) continue;
      studios.add(s.studio);
      for (const j of s.jurisdictions) {
        jurisdictions.add(j.code);
        rulesets.add(j.ruleset);
      }
    }
  }
  return {
    studios: STUDIOS.filter((s) => studios.has(s)),
    jurisdictions: JURISDICTIONS.filter((j) => jurisdictions.has(j)),
    rulesets: [...rulesets],
  };
}

/** The two Sovkora Studios of the document-validation pack Verikora runs. */
export const STUDIOS = ["compliance-check", "document-authenticity"] as const;
export const studio = z.enum(STUDIOS);
export type Studio = z.infer<typeof studio>;

/** The rulesets the compliance Studio carries (sovkora-packs document-validation/rulesets). Québec first: our market. */
export const JURISDICTIONS = ["QC", "FR", "BE-WAL"] as const;
export const jurisdiction = z.enum(JURISDICTIONS);
export type Jurisdiction = z.infer<typeof jurisdiction>;

/** An account's territory (krizaka-internal#2292): one of the jurisdictions that have a ruleset, or `ZZ`, « another territory », which lists every check. */
export const OTHER_TERRITORY = "ZZ";
export const TERRITORIES = [...JURISDICTIONS, OTHER_TERRITORY] as const;
export const territory = z.enum(TERRITORIES);
export type Territory = z.infer<typeof territory>;
/** A stored territory code as one of the closed set: a code the set does not know is « another territory ». */
export const asTerritory = (code: string): Territory => {
  const parsed = territory.safeParse(code);
  return parsed.success ? parsed.data : OTHER_TERRITORY;
};

export const ANALYSIS_STATUSES = ["running", "succeeded", "failed", "cancelled"] as const;
/** The same four words as a vocabulary, for comparisons (`status === ANALYSIS_STATUS.running`). */
export const ANALYSIS_STATUS = {
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<(typeof ANALYSIS_STATUSES)[number], (typeof ANALYSIS_STATUSES)[number]>;
export const analysisStatus = z.enum(ANALYSIS_STATUSES);
export type AnalysisStatus = z.infer<typeof analysisStatus>;

/** Sovkora's run statuses (sovkora-studio-service RunStatus) as Verikora shows them. Unknown → running (it will be asked again). */
export function fromRunStatus(status: string): AnalysisStatus {
  switch (status) {
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "running";
  }
}

export const isOver = (status: AnalysisStatus) => status !== "running";

/** A document's state in the library, derived from its analyses. */
export const documentStatus = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatus>;

// ── Reports, as Sovkora returns them (sovkora-packs document-validation) ─────────────────────────────────────────────

export const VERDICTS = ["PASS", "FAIL", "INSUFFICIENT_EVIDENCE"] as const;
export const finding = z.object({
  ruleId: z.string(),
  title: z.string().optional(),
  severity: z.string(),
  verdict: z.string(),
  evidenceSpan: z
    .object({ start: z.number().nullish(), end: z.number().nullish(), quote: z.string() })
    .nullable()
    .optional(),
  explanation: z.string(),
  /** The same sentence in English, for the findings Verikora itself writes (the tenant-shield rules, #104); the engine's own are French only. */
  explanationEn: z.string().optional(),
  method: z.string().optional(),
  /** A sentence (1.x), or `{ reference, pinned, notice }` (compliance-check 2.x): the reference is the sentence shown. */
  citation: z.preprocess(
    (v) => (v && typeof v === "object" && "reference" in v ? (v as { reference: unknown }).reference : v),
    z.string().optional(),
  ),
  /** The line of the document the evidence sits on (1-based), set by Verikora while the text is still there (verikora#129). */
  line: z.number().int().positive().optional(),
});
export type Finding = z.infer<typeof finding>;

/**
 * A figure the ruleset declares it reads: found with its value, blank (the label with no amount) or absent. A value is cents (the rents of
 * Section G, verikora#554), a number of months (rent asked in advance), a yes/no (postdated cheques, notice given) or a date `YYYY-MM-DD`
 * (conclusion and start of the lease): the tenant-shield rules (#104) read these and nothing else, never free text.
 */
const factEvidence = z.object({ quote: z.string() }).passthrough().optional();
export const reportFact = z.union([
  z.object({ status: z.literal("found"), cents: z.number().int().positive(), evidenceSpan: factEvidence }),
  z.object({ status: z.literal("found"), months: z.number().int().min(0).max(120), evidenceSpan: factEvidence }),
  z.object({ status: z.literal("found"), flag: z.boolean(), evidenceSpan: factEvidence }),
  z.object({ status: z.literal("found"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), evidenceSpan: factEvidence }),
  z.object({ status: z.literal("blank"), evidenceSpan: factEvidence }),
  z.object({ status: z.literal("absent") }),
]);
export type ReportFact = z.infer<typeof reportFact>;

const complianceReportShape = z.object({
  rulesetId: z.string(),
  rulesetVersion: z.string(),
  rulesetRevision: z.number().optional(),
  jurisdiction: z.string(),
  asOf: z.string(),
  source: z.string().optional(),
  /** `TO_REVIEW_BY_LAWYER` while the ruleset awaits a lawyer's review (the Québec one does). */
  reviewStatus: z.string().optional(),
  reviewNote: z.string().optional(),
  summary: z
    .object({ byVerdict: z.record(z.string(), z.number()), blockingFailures: z.number(), rulesEvaluated: z.number() })
    .partial()
    .optional(),
  findings: z.array(finding),
  /** The figures the ruleset declares it reads; a shape this version does not know is dropped, never the report. */
  facts: z.record(z.string(), reportFact).optional().catch(undefined),
  /** Compliance-check 2.x: `CHECKED`, or `UNSUPPORTED_KIND` / `KIND_UNKNOWN` when no ruleset applied (then there is no finding, and it is not a clean report). */
  outcome: z.string().optional(),
});

/**
 * Compliance-check 2.0 nests the ruleset (`ruleset: { id, version, revision, reviewStatus }`) and carries no `rulesetId` / `jurisdiction`
 * when the document was not checked; this reads both shapes as one (1.x reports are unchanged).
 */
function flatten(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("contract" in raw || "outcome" in raw)) return raw;
  const r = raw as Record<string, unknown>;
  const ruleset = (r.ruleset && typeof r.ruleset === "object" ? r.ruleset : {}) as Record<string, unknown>;
  const identified = (r.identification && typeof r.identification === "object" ? r.identification : {}) as Record<
    string,
    unknown
  >;
  return {
    ...r,
    rulesetId: r.rulesetId ?? ruleset.id ?? "",
    rulesetVersion: r.rulesetVersion ?? ruleset.version ?? "",
    rulesetRevision: r.rulesetRevision ?? ruleset.revision,
    reviewStatus: r.reviewStatus ?? ruleset.reviewStatus ?? undefined,
    jurisdiction: r.jurisdiction ?? identified.jurisdiction ?? "",
  };
}

export const complianceReport = z.preprocess(flatten, complianceReportShape);

export type ComplianceReport = z.infer<typeof complianceReportShape>;

export const SIGNAL_LEVELS = ["observé", "inhabituel", "incohérent"] as const;
/** The families of a signal (ADR-0014 §2), in the order a report reads them. */
export const SIGNAL_FAMILIES = ["history", "layout", "images", "figures", "across"] as const;
export type SignalFamily = (typeof SIGNAL_FAMILIES)[number];
/** Where a signal sits in the file: a page, a box in PDF points [x0, y0, x1, y1], the revision of a later save, the field it concerns. All optional; an old report has none. */
export const signalEvidence = z.object({
  page: z.number().int().min(1).optional(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  revision: z.number().int().min(1).optional(),
  field: z.string().optional(),
});
export type SignalEvidence = z.infer<typeof signalEvidence>;
export const signal = z.object({
  signalId: z.string(),
  level: z.string(),
  observation: z.string(),
  mayIndicate: z.string().optional(),
  where: z.string().optional(),
  family: z.string().optional(),
  evidence: signalEvidence.optional(),
  askFor: z.string().optional(),
});
export type Signal = z.infer<typeof signal>;

const FAMILY_BY_PREFIX: ReadonlyArray<readonly [string, SignalFamily]> = [
  ["PDF-FONT", "layout"],
  ["PDF-LAYER", "layout"],
  ["DOC-PROFILE", "layout"],
  ["IMG-", "images"],
  ["CONTENT-", "figures"],
  ["REG-", "figures"],
  ["FILE-", "across"],
];
/** A signal's family: the one the engine names, else read from the case id (PDF structure and metadata are the file's history). */
export function signalFamily(s: Pick<Signal, "signalId" | "family">): SignalFamily {
  const named = SIGNAL_FAMILIES.find((f) => f === s.family);
  return named ?? FAMILY_BY_PREFIX.find(([p]) => s.signalId.startsWith(p))?.[1] ?? "history";
}

/**
 * The signals the landlord does not see (verikora#651, CTO 2026-10-30, Law 25: no automated verdict, and a false alarm on 1 genuine
 * document in 8 is not a fact about the applicant). Each measured over the 5 % false-positive bar on the 280 genuine documents of
 * the forensic corpus (sovkora-packs#191, #176); the run keeps them for measurement and the operator reads them there. `level`
 * limits the withholding to the case measured (the « absent » cases are `inhabituel`; the « declared » ones are plain facts).
 * A signal returns to the landlord's view when its measured rate passes the bar: remove its line, with the measurement linked in the PR.
 */
export const WITHHELD_FROM_LANDLORD: ReadonlyArray<{
  signalId: string;
  level?: string;
  falsePositiveRate: number;
  measurement: string;
}> = [
  { signalId: "PDF-ID-001", falsePositiveRate: 0.12, measurement: "https://github.com/krizaka/sovkora-packs/pull/191" },
  {
    signalId: "PDF-META-001",
    level: "inhabituel",
    falsePositiveRate: 0.125,
    measurement: "https://github.com/krizaka/sovkora-packs/pull/191",
  },
  {
    signalId: "IMG-META-001",
    level: "inhabituel",
    falsePositiveRate: 0.06,
    measurement: "https://github.com/krizaka/sovkora-packs/pull/191",
  },
];

/** Whether a signal is withheld from the landlord's view (applicant, console, report, note, export, search). */
export const isWithheldFromLandlord = (s: Pick<Signal, "signalId" | "level">): boolean =>
  WITHHELD_FROM_LANDLORD.some((w) => w.signalId === s.signalId && (w.level === undefined || w.level === s.level));

/** The signals the landlord may see: the same list without the withheld ones. */
export const landlordSignals = <T extends Pick<Signal, "signalId" | "level">>(signals: readonly T[]): T[] =>
  signals.filter((s) => !isWithheldFromLandlord(s));

export const authenticityReport = z.object({
  header: z.string().optional(),
  pages: z.number().optional(),
  signals: z.array(signal),
  levels: z.record(z.string(), z.string()).optional(),
  notExamined: z.union([z.string(), z.array(z.string())]).optional(),
});
export type AuthenticityReport = z.infer<typeof authenticityReport>;

/** One output of an Sovkora run (sovkora-studio-service RunArtefactResponse). */
export const runArtefact = z.object({
  key: z.string(),
  label: z.string().nullable().optional(),
  type: z.string(),
  value: z.string().nullable().optional(),
});
export type RunArtefact = z.infer<typeof runArtefact>;

/** An Sovkora run, as the edge answers it (`GET /api/v1/studios/runs/{id}`). Only what Verikora reads. */
export const sovkoraRun = z.object({
  id: z.string(),
  studioKey: z.string(),
  blueprintVersion: z.string().nullable().optional(),
  status: z.string(),
  outputs: z.array(runArtefact).default([]),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
});
export type RunPayload = z.infer<typeof sovkoraRun>;

const json = (value: string | null | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

/**
 * The report a finished run carries, read from its outputs: the compliance Studio's `report` (JSON — the assembled
 * report, wrapped in `{ report }` or bare), the authenticity Studio's `signals` (JSON). A shape Sovkora did not send is
 * `null`, never a guess.
 */
export function reportOf(
  studioKey: Studio,
  outputs: readonly RunArtefact[],
): ComplianceReport | AuthenticityReport | null {
  const pick = (key: string) => outputs.find((o) => o.key === key)?.value;
  if (studioKey === "compliance-check") {
    const raw = json(pick("report")) as { report?: unknown } | undefined;
    const parsed = complianceReport.safeParse(raw && typeof raw === "object" && "report" in raw ? raw.report : raw);
    return parsed.success ? parsed.data : null;
  }
  const raw = json(pick("signals")) as { report?: unknown } | undefined;
  const parsed = authenticityReport.safeParse(raw && typeof raw === "object" && "report" in raw ? raw.report : raw);
  return parsed.success ? parsed.data : null;
}

// ── The API ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const analysis = z.object({
  id: z.string(),
  studio,
  status: analysisStatus,
  /** The Sovkora run this analysis is — shown in the UI, the trace of what ran. */
  runId: z.string().nullable(),
  blueprintVersion: z.string().nullable(),
  inputs: z.record(z.string(), z.string()),
  report: z.union([complianceReport, authenticityReport]).nullable(),
  error: z.string().nullable(),
  /** True when the run failed and the audit it spent (free, paid or pilot credit) was given back: the failure message says so. */
  creditRestored: z.boolean().optional(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Analysis = z.infer<typeof analysis>;

/** The marker the demo seed writes in a check's inputs (scripts/demo-seed): no engine ran, the result was written. */
export const SEEDED_INPUTS = { seeded: "true" } as const;
/** A seeded demo check is shown like any other but never certified, reused, or taken as the current Studio version. */
export const isSeededCheck = (check: Pick<Analysis, "inputs">): boolean => check.inputs.seeded === SEEDED_INPUTS.seeded;

export const documentSummary = z.object({
  id: z.string(),
  title: z.string(),
  filename: z.string(),
  mimeType: acceptedType,
  kind: documentKind,
  sizeBytes: z.number().int().nonnegative(),
  pages: z.number().int().nullable(),
  /** Whether a text layer was read (a scanned PDF has none: the compliance check needs one). */
  hasText: z.boolean(),
  status: documentStatus,
  /** Whether the text is read yet (verikora#21); absent on a document read before the status existed: it is `done`. */
  extraction: extractionStatus.optional(),
  createdAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSummary>;

/** What the document is and what it holds, read in-process from its text (apps/web/lib/understanding, lib/pii). Values of personal information are never here — only counts. */
const labelled = z.object({ fr: z.string(), en: z.string() });
export const documentInsight = z.object({
  understanding: z.object({
    nature: z
      .object({
        id: z.string(),
        label: labelled,
        confidence: z.enum(["high", "medium", "low", "unknown"]),
        score: z.number(),
      })
      .nullable(),
    alternative: z.object({ id: z.string(), label: labelled }).nullable(),
    language: z.enum(["fr", "en", "unknown"]),
    pages: z.number().nullable(),
    issuer: z.string().nullable(),
    dates: z.array(
      z.object({
        kind: z.enum(["issued", "effective", "due", "period", "other"]),
        value: z.string(),
        text: z.string(),
      }),
    ),
    parties: z.array(z.object({ role: z.string(), name: z.string() })),
    references: z.array(z.object({ kind: z.string(), value: z.string() })),
    amounts: z.array(z.object({ kind: z.string(), cents: z.number(), text: z.string() })),
    check: z
      .object({
        studio: z.literal("compliance-check"),
        documentType: z.enum(["lease", "invoice", "contract", "visit-notice", "premises-condition"]),
        ruleset: z.string().nullable(),
      })
      .nullable(),
    authenticity: z.boolean(),
    needsModel: z.boolean(),
  }),
  pii: z.object({ total: z.number(), counts: z.record(z.string(), z.number()) }),
});
export type DocumentInsight = z.infer<typeof documentInsight>;

/** The values of a closed set, as the non-empty tuple `z.enum` wants. */
const valuesOf = <T extends Record<string, string>>(set: T) => Object.values(set) as [T[keyof T], ...T[keyof T][]];

/** Where a document lives: the DocumentStore adapters, the database (the home of a document kept with Krizaka) and the person's device. */
export const STORAGE_KIND = {
  none: "none",
  database: "database",
  bunny: "bunny",
  s3: "s3",
  cloud: "cloud",
  device: "device",
} as const;
export type StorageKind = (typeof STORAGE_KIND)[keyof typeof STORAGE_KIND];

/** Whose storage it is: Krizaka's, the workspace's own cloud, or the person's device. */
export const STORAGE_OWNER = { krizaka: "krizaka", workspace: "workspace", device: "device" } as const;
export type StorageOwner = (typeof STORAGE_OWNER)[keyof typeof STORAGE_OWNER];
/** The owners of a store a server talks to (a device is never one). */
export type CloudOwner = Exclude<StorageOwner, "device">;

export const STORAGE_RESIDENCY = {
  canada: "canada",
  elsewhere: "elsewhere",
  unknown: "unknown",
  device: "device",
} as const;
export type StorageResidency = (typeof STORAGE_RESIDENCY)[keyof typeof STORAGE_RESIDENCY];

/** The adapters a deployment can be configured with (`MEDIA_DOCUMENTS_PROVIDER`): nothing kept, or an external store. */
export const STORAGE_PROVIDERS = [STORAGE_KIND.none, STORAGE_KIND.bunny, STORAGE_KIND.s3] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** What a person chooses for their kept documents: nothing, Krizaka's store, their own S3, or a cloud they connected (Dropbox, Google Drive, OneDrive). */
export const STORAGE_MODE = { none: "none", krizaka: "krizaka", s3: "s3", cloud: "cloud" } as const;
export type StorageMode = (typeof STORAGE_MODE)[keyof typeof STORAGE_MODE];
export const STORAGE_MODES = valuesOf(STORAGE_MODE);

/** Where a document lives (the DocumentStore adapter that holds it), as the info panel says it (apps/web/lib/storage). */
export const storageDescriptor = z.object({
  kind: z.enum(valuesOf(STORAGE_KIND)),
  endpoint: z.string().nullable(),
  region: z.string().nullable(),
  residency: z.enum(valuesOf(STORAGE_RESIDENCY)),
  encrypted: z.boolean(),
  owner: z.enum(valuesOf(STORAGE_OWNER)),
  devOnly: z.boolean(),
});
export type StorageDescriptor = z.infer<typeof storageDescriptor>;

/** Where a photo came from, read before its metadata was dropped (never a verdict): the device, the last editor, the dates, and whether a GPS position was there (never the position). */
export const photoOrigin = z.object({
  software: z.string().nullable(),
  device: z.string().nullable(),
  takenAt: z.string().nullable(),
  modifiedAt: z.string().nullable(),
  hadGps: z.boolean(),
});
export type PhotoOrigin = z.infer<typeof photoOrigin>;

/** How a document's text was read when it was not a text layer: by local character recognition, or — when that was not reliable — by Sovkora's vision model (with its run). */
/** How a document's text was read, as constants. */
export const TEXT_SOURCE = { ocr: "ocr", vision: "vision" } as const;
/** A collection's avatar: one of the set (a seed the UI draws) or an uploaded image (served at `/api/collections/{id}/avatar?v=<version>`). The same shape on the web, the Mac, iOS and Android. */
/** The avatar set: seeds the UI turns into a picture (Krizaka UI's default avatars in the product's colours); the administrator chooses which are offered. */
export const AVATAR_SEEDS = ["v1", "v2", "v3", "v4", "v5", "v6"] as const;
export const AVATAR_KIND = { set: "set", image: "image" } as const;
export const collectionAvatar = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal(AVATAR_KIND.set), seed: z.string().regex(/^[a-z0-9-]{1,24}$/) }),
  z.object({ kind: z.literal(AVATAR_KIND.image), version: z.number().int().min(1) }),
]);
export type CollectionAvatar = z.infer<typeof collectionAvatar>;
export const textSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TEXT_SOURCE.ocr),
    engine: z.string(),
    confidence: z.number(),
    photos: z.number().int(),
    lowConfidence: z.boolean(),
    origin: photoOrigin.nullable(),
  }),
  z.object({
    kind: z.literal(TEXT_SOURCE.vision),
    by: z.literal("sovkora"),
    runId: z.string(),
    model: z.string().nullable(),
    localConfidence: z.number(),
    photos: z.number().int(),
    origin: photoOrigin.nullable(),
  }),
]);
export type TextSource = z.infer<typeof textSource>;

export const documentDetail = documentSummary.extend({
  /** The code of the refusal when the reading `failed` (the page translates it). */
  extractionError: z.string().nullable().optional(),
  /** Set for a document made from photos; absent for a PDF or a text file (their text is read, not recognised). */
  textSource: textSource.optional(),
  insight: documentInsight.optional(),
  sha256: z.string(),
  text: z.string(),
  analyses: z.array(analysis),
});
export type DocumentDetail = z.infer<typeof documentDetail>;

/** What the document page shows: the detail plus where it lives and until when (ADR-0007). */
export const documentView = documentDetail.extend({
  storage: storageDescriptor,
  /** When it is purged (ISO), or null: kept until the person deletes it. */
  retainUntil: z.string().nullable(),
  /** Not kept and already purged: only the report stays. */
  purged: z.boolean(),
});
export type DocumentView = z.infer<typeof documentView>;

/** The rulesets the Studio takes by name besides each jurisdiction's lease (sovkora-packs `document-validation`): Québec's supplier invoice, service contract, visit notice and état des lieux (sovkora-packs#128). */
export const NAMED_RULESETS = [
  "qc-invoice",
  "qc-service-contract",
  "qc-visit-notice",
  "qc-premises-condition",
] as const;
export const namedRuleset = z.enum(NAMED_RULESETS);
/** Québec's lease at a version in force (`qc-residential-lease/2026-10-24`, ADR-089): the date picks it, the check records it. */
export const DATED_LEASE_RULESET = /^qc-residential-lease\/\d{4}-\d{2}-\d{2}$/;

export const startAnalysis = z.discriminatedUnion("studio", [
  z
    .object({
      studio: z.literal("compliance-check"),
      jurisdiction,
      asOf: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      /** Not the jurisdiction's lease but this document type's rules; the Québec invoice belongs to QC only. */
      ruleset: z.union([namedRuleset, z.string().regex(DATED_LEASE_RULESET)]).optional(),
    })
    .refine((r) => !r.ruleset || r.jurisdiction === "QC", {
      message: "The named rulesets are Québec's",
      path: ["ruleset"],
    }),
  z.object({
    studio: z.literal("document-authenticity"),
    expectedIssuer: z.string().trim().max(120).optional(),
  }),
]);
export type StartAnalysis = z.infer<typeof startAnalysis>;

export const searchHit = z.object({
  documentId: z.string(),
  title: z.string(),
  kind: documentKind,
  /** Where the words were found: the document's text, or a finding of one of its analyses. */
  source: z.enum(["text", "finding", "title"]),
  /** The passage, `<b>…</b>` around the matched words (the server escapes everything else). */
  passage: z.string(),
  rank: z.number(),
});
export type SearchHit = z.infer<typeof searchHit>;

export const adminUser = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["USER", "ADMIN"]),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  documents: z.number().int(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUser>;

/** The query keys of @krizaka/query — one place, so an invalidation never misses a list. */
export const queryKeys = {
  documents: () => ["documents"] as const,
  document: (id: string) => ["documents", id] as const,
  search: (q: string) => ["search", q] as const,
  adminUsers: () => ["admin", "users"] as const,
};

/**
 * The document's text cut around the passages a report quotes, for the viewer: plain runs and marked runs, in order.
 * A quote is found by its offsets when they still match the text, else by its first occurrence; a quote that is not in
 * the text is left out (it is shown in the finding, never invented in the document).
 */
export function passages(
  text: string,
  quotes: readonly { id: string; quote: string; start?: number | null; end?: number | null }[],
): { text: string; mark?: string }[] {
  const spans: { start: number; end: number; id: string }[] = [];
  for (const q of quotes) {
    if (!q.quote) continue;
    const start =
      typeof q.start === "number" && text.slice(q.start, q.start + q.quote.length) === q.quote
        ? q.start
        : text.indexOf(q.quote);
    if (start < 0) continue;
    const end = start + q.quote.length;
    if (spans.some((s) => start < s.end && end > s.start)) continue;
    spans.push({ start, end, id: q.id });
  }
  spans.sort((a, b) => a.start - b.start);
  const out: { text: string; mark?: string }[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.start > at) out.push({ text: text.slice(at, s.start) });
    out.push({ text: text.slice(s.start, s.end), mark: s.id });
    at = s.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) });
  return out;
}
export * from "./organisation";
export * from "./closing-note";
export * from "./steps";
export * from "./batch";
export * from "./document-store";
export * from "./extraction";
export { memoryStore } from "./document-store-memory";

export {
  CHECKS_TABS,
  type ChecksTab,
  PLATFORMS,
  type Platform,
  type Section,
  SECTION_IDS,
  type SectionId,
  SECTIONS,
  sectionShortcut,
  sectionsFor,
} from "./sections";
export * from "./forensics";
export * from "./forensics-text";
export * from "./ingress";
