import crypto from "node:crypto";

import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { z } from "zod";

import { INTL } from "@/components/console/format";
import { PRODUCT_NAME } from "@/lib/brand";

import { format, getDictionary, type Locale } from "./i18n";
import type { OwnerReport } from "./owner-report";
import { traceCardsOf } from "./owner-traces";
import { drawPages, embedFonts, type Face, type Fonts, paginate, printable, signedBodyOf } from "./pdf-layout";
import { canonicalJson, sha256 } from "./report";
import { type SigningKey } from "./report-key";
import { ATTESTATION_KEY } from "./report-pdf";

/*
 * The signed PDF of the owner report (verikora#481): the redacted report of an applicant file (hashes, signals, rules,
 * runs — no name, e-mail, file name or quoted passage), sealed like the compliance PDF: Ed25519 over the canonical
 * payload and the SHA-256 of the pages' text, the attestation in the Info key `VerikoraAttestation`. It has its own
 * payload schema (`verikora.owner-report/1`); the signature format, the key and the verification are the same.
 * ADR-0002: no specimen exists, nothing public — only the owner link, while it is valid, delivers it.
 */
export const OWNER_REPORT_SCHEMA = "verikora.owner-report/1";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const ownerReportPayload = z
  .object({
    schema: z.literal(OWNER_REPORT_SCHEMA),
    lang: z.enum(["en", "fr"]),
    reference: z.string(),
    issuedAt: z.string(),
    /** The link's expiry: the report is read while it is valid. */
    expiresAt: z.string(),
    documents: z.array(
      z
        .object({
          typeId: z.string().nullable(),
          sha256: sha,
          pages: z.number().nullable(),
          signals: z.array(
            z
              .object({
                id: z.string(),
                level: z.string(),
                observation: z.string(),
                family: z.string().optional(),
                evidence: z
                  .object({
                    page: z.number().int().optional(),
                    revision: z.number().int().optional(),
                    field: z.string().optional(),
                  })
                  .strict()
                  .optional(),
                answer: z.object({ text: z.string(), at: z.string() }).strict().optional(),
              })
              .strict(),
          ),
          findings: z.array(
            z
              .object({
                ruleId: z.string(),
                verdict: z.string(),
                severity: z.string(),
                citation: z.string().nullable(),
              })
              .strict(),
          ),
          notExamined: z.array(z.string()),
          runs: z.array(
            z
              .object({
                studio: z.string(),
                runId: z.string(),
                studioVersion: z.string().nullable(),
                finishedAt: z.string().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    rulesets: z.array(
      z
        .object({
          jurisdiction: z.string(),
          rulesetId: z.string(),
          rulesetVersion: z.string(),
          reviewStatus: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type OwnerReportPayload = z.infer<typeof ownerReportPayload>;

export interface OwnerAttestation {
  schema: typeof OWNER_REPORT_SCHEMA;
  algorithm: "Ed25519";
  keyId: string;
  payload: OwnerReportPayload;
  bodySha256: string;
  signature: string;
}
const attestationSchema = z.object({
  schema: z.literal(OWNER_REPORT_SCHEMA),
  algorithm: z.literal("Ed25519"),
  keyId: z.string(),
  payload: ownerReportPayload,
  bodySha256: sha,
  signature: z.string(),
});

/** The payload of a report opened through its link: only the redacted fields, parsed through the strict schema (an extra key throws). */
export const ownerPayloadOf = (report: OwnerReport & { expiresAt: string }, lang: Locale): OwnerReportPayload =>
  ownerReportPayload.parse({
    schema: OWNER_REPORT_SCHEMA,
    lang,
    reference: report.reference,
    issuedAt: report.issuedAt,
    expiresAt: report.expiresAt,
    documents: report.documents.map((d) => ({
      typeId: d.typeId,
      sha256: d.sha256,
      pages: d.pages,
      signals: d.signals.map((s) => ({
        id: s.id,
        level: s.level,
        observation: s.observation,
        ...(s.family ? { family: s.family } : {}),
        ...(s.evidence ? { evidence: s.evidence } : {}),
        ...(s.answer ? { answer: s.answer } : {}),
      })),
      findings: d.findings.map((f) => ({
        ruleId: f.ruleId,
        verdict: f.verdict,
        severity: f.severity,
        citation: f.citation,
      })),
      notExamined: d.notExamined,
      runs: d.runs.map((r) => ({
        studio: r.studio,
        runId: r.runId,
        studioVersion: r.studioVersion,
        finishedAt: r.finishedAt,
      })),
    })),
    rulesets: report.rulesets.map((r) => ({
      jurisdiction: r.jurisdiction,
      rulesetId: r.rulesetId,
      rulesetVersion: r.rulesetVersion,
      reviewStatus: r.reviewStatus,
    })),
  });

const signedMessage = (payload: OwnerReportPayload, bodySha256: string) =>
  Buffer.from(canonicalJson({ bodySha256, payload }), "utf8");

type Block = { text: string; size: number; face?: Face; gap?: number };
const b = (text: string, size = 9, extra: Partial<Block> = {}): Block => ({ text, size, ...extra });

/** The traces of a document as the owner page draws them (the same cards as the report): by family, each with where it sits, its ordinary explanations and what to ask for. */
const traceBlocks = (signals: OwnerReportPayload["documents"][number]["signals"], lang: Locale): Block[] =>
  traceCardsOf(signals, lang).flatMap((g) => [
    b(g.title, 9, { face: "bold", gap: 1 }),
    ...g.cards.flatMap((c) => c.map((line, i) => b(i === 0 ? `- ${line}` : `  ${line}`))),
  ]);

/** The pages' text, in reading order, from the messages of the payload's language. Exactly the owner page's content. */
export function ownerReportBlocks(payload: OwnerReportPayload): Block[] {
  const w = getDictionary(payload.lang).ownerReport;
  const verdicts: Record<string, string> = w.verdict;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(INTL[payload.lang], { dateStyle: "long", timeZone: "UTC" });
  const out: Block[] = [
    b(w.title, 18, { face: "bold", gap: 6 }),
    b(w.lead, 9, { gap: 4 }),
    b(
      `${format(w.reference, { ref: payload.reference })} · ${format(w.issued, { date: date(payload.issuedAt) })}`,
      10,
      { gap: 2 },
    ),
    b(format(w.expires, { date: date(payload.expiresAt) }), 9, { gap: 2 }),
    b(w.notice, 10, { face: "bold", gap: 8 }),
    b(w.documents, 12, { face: "bold", gap: 2 }),
  ];
  for (const [i, d] of payload.documents.entries()) {
    out.push(
      b(format(w.document, { n: String(i + 1) }), 11, { face: "bold", gap: 1 }),
      b(`${w.type}: ${d.typeId ?? w.typeUnknown}`),
      b(`${w.sha}: ${d.sha256}`, 8, { face: "mono" }),
      ...(d.pages ? [b(`${w.pages}: ${d.pages}`)] : []),
      b(w.signals, 9, { face: "bold", gap: 1 }),
      ...(d.signals.length ? traceBlocks(d.signals, payload.lang) : [b(w.noSignals)]),
      b(w.findings, 9, { face: "bold", gap: 1 }),
      ...(d.findings.length
        ? d.findings.map((f) =>
            b(`- ${verdicts[f.verdict] ?? f.verdict}: ${[f.ruleId, f.citation].filter(Boolean).join(", ")}`),
          )
        : [b(w.noFindings)]),
      ...(d.notExamined.length ? [b(`${w.notExamined}: ${d.notExamined.join(", ")}`, 9, { face: "bold" })] : []),
      b(w.runs, 9, { face: "bold", gap: 1 }),
      ...d.runs.map((r, n) =>
        b(format(w.run, { studio: r.studio, runId: r.runId, version: r.studioVersion ?? w.versionNone }), 8, {
          face: "mono",
          gap: n === d.runs.length - 1 ? 8 : 4,
        }),
      ),
    );
  }
  for (const r of payload.rulesets) {
    const review = r.reviewStatus ? format(w.reviewStatus, { status: r.reviewStatus }) : "";
    out.push(
      b(
        `${format(w.ruleset, { id: r.rulesetId, version: r.rulesetVersion, jurisdiction: r.jurisdiction })} ${review}`.trim(),
        9,
        { gap: 4 },
      ),
    );
  }
  out.push(b(w.limits, 9, { gap: 8 }), b(w.guarantees), b(w.notGuaranteed), b(w.footer, 8));
  return out;
}

const textOf = (blocks: Block[], fonts: Fonts) =>
  blocks
    .map((x) => printable(x.text, fonts.regular))
    .join("")
    .replace(/\s+/g, "");

export interface IssuedOwnerPdf {
  bytes: Uint8Array;
  fileSha256: string;
  attestation: OwnerAttestation;
}

/** Lays out, hashes the text, signs, embeds. Deterministic: the same payload gives the same bytes. */
export async function issueOwnerReportPdf(
  payload: OwnerReportPayload,
  key: SigningKey,
  name = PRODUCT_NAME,
): Promise<IssuedOwnerPdf> {
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const blocks = ownerReportBlocks(payload);
  const line = (x: Block) => ({
    text: printable(x.text, fonts.regular),
    size: x.size,
    face: x.face ?? "regular",
    gap: x.gap ?? 4,
  });
  const body = paginate(blocks.map(line), fonts, 0);
  const bodySha256 = sha256(textOf(blocks, fonts));
  const signature = crypto.sign(null, signedMessage(payload, bodySha256), key.privateKey).toString("base64");
  const attestation: OwnerAttestation = {
    schema: OWNER_REPORT_SCHEMA,
    algorithm: "Ed25519",
    keyId: key.keyId,
    payload,
    bodySha256,
    signature,
  };
  const l = getDictionary(payload.lang);
  const labels = l.report;
  const w = l.ownerReport;
  const [signaturePage] = paginate(
    [
      b(labels.signatureHeading, 16, { face: "bold", gap: 8 }),
      b(`${labels.signatureAlgorithm}: Ed25519`, 10, { gap: 2 }),
      b(`${labels.signatureKey}: ${key.keyId}`, 9, { face: "mono", gap: 2 }),
      b(`${labels.signatureBody}: ${bodySha256}`, 8, { face: "mono", gap: 2 }),
      b(`${labels.signatureValue}: ${signature}`, 8, { face: "mono", gap: 10 }),
      b(w.signatureNote),
    ].map(line),
    fonts,
    0,
  );
  drawPages(doc, fonts, [...body, signaturePage!]);
  const issued = new Date(payload.issuedAt);
  doc.setTitle(`${w.title} ${payload.reference}`);
  doc.setSubject(`${name} — ${payload.reference}`);
  doc.setProducer(name);
  doc.setCreator(name);
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(
    PDFName.of(ATTESTATION_KEY),
    PDFString.of(Buffer.from(JSON.stringify(attestation), "utf8").toString("base64")),
  );
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, fileSha256: sha256(bytes), attestation };
}

export type OwnerVerification =
  | { ok: true; fileSha256: string; keyId: string; payload: OwnerReportPayload }
  | {
      ok: false;
      reason: "NOT_A_REPORT" | "UNREADABLE" | "BAD_SIGNATURE" | "ALTERED" | "UNKNOWN_KEY";
      fileSha256: string;
    };

/** The attestation an owner-report PDF carries (not checked), or null — never throws. */
export async function ownerAttestationOfPdf(bytes: Uint8Array): Promise<OwnerAttestation | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const raw = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).get(PDFName.of(ATTESTATION_KEY));
    if (!(raw instanceof PDFString)) {
      return null;
    }
    return attestationSchema.parse(JSON.parse(Buffer.from(raw.asString(), "base64").toString("utf8")));
  } catch {
    return null;
  }
}

/** Signature first, then the text of the pages against the signed fingerprint, like `verifyPdf`. */
export async function verifyOwnerReportPdf(
  bytes: Uint8Array,
  key: Pick<SigningKey, "keyId" | "publicKey">,
): Promise<OwnerVerification> {
  const fileSha256 = sha256(bytes);
  const fail = (reason: Extract<OwnerVerification, { ok: false }>["reason"]): OwnerVerification => ({
    ok: false,
    reason,
    fileSha256,
  });
  if (!(bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-")) {
    return fail("NOT_A_REPORT");
  }
  const attestation = await ownerAttestationOfPdf(bytes);
  if (!attestation) {
    return fail("UNREADABLE");
  }
  if (attestation.keyId !== key.keyId) {
    return fail("UNKNOWN_KEY");
  }
  if (
    !crypto.verify(
      null,
      signedMessage(attestation.payload, attestation.bodySha256),
      key.publicKey,
      Buffer.from(attestation.signature, "base64"),
    )
  ) {
    return fail("BAD_SIGNATURE");
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  try {
    const pages = (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false }))
      .text as string[];
    const text = signedBodyOf(pages);
    if (text === null || sha256(text) !== attestation.bodySha256) {
      return fail("ALTERED");
    }
  } catch {
    return fail("UNREADABLE");
  }
  return { ok: true, fileSha256, keyId: attestation.keyId, payload: attestation.payload };
}
