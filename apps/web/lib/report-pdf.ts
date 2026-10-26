import crypto from "node:crypto";

import { PDFDict, PDFDocument, type PDFFont, PDFName, PDFString } from "pdf-lib";
import { z } from "zod";

import { LINE, type LineKind, noteLines } from "./closing-note/render";
import { numberFindings } from "./document-face";
import { drawPages, embedFonts, type Face, foldToWinAnsi, type Fonts, LINE_HEIGHT, PAGE, paginate, printable, signedBodyOf, wrap } from "./pdf-layout";

export { foldToWinAnsi };
import { type Attestation, fill, REPORT_SCHEMA, type ReportLabels, type ReportPayload, reportPayload, sha256, signedMessage, type Verification, type VerifyFailure } from "./report";
import { type SigningKey } from "./report-key";
import { SITE_URL } from "./site";

/*
 * The signed PDF report of a compliance check — for the owner and the members the owner gave access to (ADR-0002).
 *
 * The same attestation as the HTML report, in a file people print and file: the report's pages, then a visible signature
 * page. What is signed is the canonical JSON `payload` and the SHA-256 of the report's TEXT (every page before the
 * signature page); the attestation is embedded in the PDF (its Info dictionary, key `YomizakaAttestation`, base64 JSON).
 * Verification reads it back, checks the Ed25519 signature, then extracts the text of the pages with pdf.js and compares
 * it: a changed word on any page is `ALTERED`. Deterministic: the same payload and labels give the same bytes.
 *
 * It does NOT sign the PDF's bytes (a viewer that re-saves a file changes them): it signs what the file says.
 */
export const ATTESTATION_KEY = "YomizakaAttestation";

/** How each kind of line of the closing note is printed. */
const NOTE_STYLE: Record<LineKind, { size: number; bold?: boolean; gap?: number }> = {
  [LINE.title]: { size: 12, bold: true, gap: 2 },
  [LINE.heading]: { size: 10, bold: true, gap: 1 },
  [LINE.text]: { size: 9 },
  [LINE.item]: { size: 9 },
  [LINE.note]: { size: 9, bold: true, gap: 4 },
};

/** `footnote`: the note is printed at the foot of the first page, marked ¹ ² ³ in the order given, and pointed to from the summary. */
type Block = { text: string; size: number; bold?: boolean; mono?: boolean; gap?: number; footnote?: number };

/** The superscripts WinAnsi has (¹ ² ³): at most three footnotes. */
const MARKS = ["\u00b9", "\u00b2", "\u00b3"] as const;

const block = (text: string, size = 10, extra: Partial<Block> = {}): Block => ({ text, size, ...extra });
/** An optional piece of a line, or nothing: keeps the conditionals out of the template literals. */
const optional = (present: boolean, text: string) => (present ? text : "");

/** The top of the report: who says what, the disclaimer, the summary and the review notices. */
function headerBlocks(payload: ReportPayload, labels: ReportLabels): Block[] {
  // The review note and the contract's non-check are footnotes (the signed PDF is paper: folios, numbered findings, footnotes — design § 3.2).
  const notes = [
    ...(payload.check.reviewStatus ? [block(labels.toReview!, 8, { footnote: 1 })] : []),
    ...(payload.check.rulesetId === "qc-service-contract" ? [block(labels.notCheckedServiceContract!, 8, { bold: true, footnote: 1 })] : []),
  ].map((note, i) => ({ ...note, footnote: i + 1 }));
  const marks = notes.map((n) => MARKS[n.footnote! - 1]).join("");
  return [
    block(labels.eyebrow!, 8, { gap: 2 }),
    block(payload.document.title, 18, { bold: true, gap: 6 }),
    block(labels.disclaimer!, 10, { bold: true, gap: 8 }),
    block(`${fill(labels.summary!, { failures: payload.summary.blockingFailures, rules: payload.summary.rulesEvaluated })}${marks}`, 10, { gap: 8 }),
    ...notes,
  ];
}

/** The document that was checked: its file, size and fingerprint. */
function documentBlocks(payload: ReportPayload, labels: ReportLabels): Block[] {
  const d = payload.document;
  const pages = optional(!!d.pages, ` · ${d.pages} p.`);
  return [
    block(labels.documentHeading!, 12, { bold: true, gap: 2 }),
    block(`${labels.file}: ${d.filename}`, 9),
    block(`${labels.size}: ${d.sizeBytes} B${pages}`, 9),
    block(`${labels.documentSha}: ${d.sha256}`, 8, { mono: true, gap: 8 }),
  ];
}

/** The check that was run: engine, run id, jurisdiction, ruleset, times. */
function checkBlocks(payload: ReportPayload, labels: ReportLabels): Block[] {
  const c = payload.check;
  const version = optional(!!c.studioVersion, ` ${c.studioVersion}`);
  const revision = optional(c.rulesetRevision !== null, ` (rev. ${c.rulesetRevision})`);
  return [
    block(labels.checkHeading!, 12, { bold: true, gap: 2 }),
    block(`${labels.engine}: ${c.engine} · ${c.studio}${version}`, 9),
    block(`${labels.runId}: ${c.runId}`, 8, { mono: true }),
    block(`${labels.jurisdiction}: ${c.jurisdiction}`, 9),
    block(`${labels.asOf}: ${c.asOf}`, 9),
    block(`${labels.ruleset}: ${c.rulesetId} · ${c.rulesetVersion}${revision}`, 9),
    block(`${labels.model}: ${labels.modelValue}`, 9),
    block(`${labels.started}: ${c.startedAt}`, 9),
    block(`${labels.finished}: ${c.finishedAt}`, 9, { gap: 8 }),
  ];
}

/** One finding, numbered as on the screen: its verdict, explanation, rule, citation and the passage it rests on. */
function findingBlocks(n: number, f: ReportPayload["findings"][number], labels: ReportLabels): Block[] {
  const method = optional(!!f.method, ` · ${f.method}`);
  const passage = f.quote ? `« ${f.quote} »` : labels.noPassage;
  const verdict = labels[`verdict.${f.verdict}`] ?? f.verdict;
  const blocks = [
    block(`${n}. ${f.title ?? f.ruleId} — ${verdict}`, 10, { bold: true, gap: 1 }),
    block(f.explanation, 9),
    block(`${labels.rule}: ${f.ruleId} · ${f.severity}${method}`, 8),
  ];
  if (f.citation) blocks.push(block(`${labels.article}: ${f.citation}`, 8));
  blocks.push(block(`${labels.passage}: ${passage}`, 8, { gap: 6 }));
  return blocks;
}

/** The closing note, line by line, in the style of each kind of line. */
function noteBlocks(note: NonNullable<ReportPayload["note"]>): Block[] {
  return noteLines(note).map(({ kind, text }) => block(kind === LINE.item ? `- ${text}` : text, NOTE_STYLE[kind].size, NOTE_STYLE[kind]));
}

/** What the signature guarantees and does not, how to verify, the footer. */
function guaranteeBlocks(labels: ReportLabels): Block[] {
  return [
    block(labels.guaranteeHeading!, 12, { bold: true, gap: 2 }),
    block(labels.guarantees!, 9),
    block(labels.notGuaranteed!, 9),
    block(fill(labels.howToVerify!, { url: `${SITE_URL}/app/verifications/report` }), 9),
    block(labels.footer!, 8),
  ];
}

/** The report's text, in reading order: what the pages print and what the signature covers. */
export function reportBlocks(payload: ReportPayload, labels: ReportLabels): Block[] {
  const { attention, passed } = numberFindings(payload.findings);
  return [
    ...headerBlocks(payload, labels),
    ...documentBlocks(payload, labels),
    ...checkBlocks(payload, labels),
    block(fill(labels.findingsHeading!, { count: payload.findings.length }), 12, { bold: true, gap: 2 }),
    // In the screen's order (what needs a look first, then what passed) and with the screen's numbers: « 3 » is the same finding on paper.
    ...[...attention, ...passed].flatMap(({ n, finding }) => findingBlocks(n, finding, labels)),
    ...(payload.note ? noteBlocks(payload.note) : []),
    ...guaranteeBlocks(labels),
  ];
}

/** The blocks in the order the pages print them: the footnotes first (they sit at the foot of the first page, which prints them first), then the body. */
const inPrintOrder = (blocks: Block[]) => [...blocks.filter((b) => b.footnote), ...blocks.filter((b) => !b.footnote)];

/** What is printed for a block: a footnote is led by its mark. */
const printedText = (b: Block) => (b.footnote ? `${MARKS[b.footnote - 1]} ${b.text}` : b.text);

/** The text the signature covers: the blocks in print order, printable, with every whitespace removed (wrapping must not matter). The folios are not part of it. */
export const signedText = (blocks: Block[], font: PDFFont) => inPrintOrder(blocks).map((b) => printable(printedText(b), font)).join("").replace(/\s+/g, "");

export interface IssuedPdf {
  bytes: Uint8Array;
  /** SHA-256 of the file as delivered. */
  fileSha256: string;
  attestation: Attestation;
}

const faceOf = (b: Block): Face => (b.mono ? "mono" : b.bold ? "bold" : "regular");

/** Lays out, hashes the text, signs, embeds. Each page carries its folio and the first one its footnotes; the findings are numbered as on the screen. */
export async function issuePdf(payload: ReportPayload, labels: ReportLabels, key: SigningKey): Promise<IssuedPdf> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = await embedFonts(doc);
  const blocks = reportBlocks(payload, labels);
  const printable_ = (b: Block) => ({ text: printable(printedText(b), fonts.regular), size: b.size, face: faceOf(b), gap: b.gap ?? 4 });
  const width = PAGE.w - PAGE.margin * 2;

  // The footnotes sit at the foot of the first page: their height is reserved there, the body flows above it.
  const notes = blocks.filter((b) => b.footnote).map(printable_);
  const footLines = notes.flatMap((n) => wrap(n.text, fonts[n.face], n.size, width).map((text) => ({ ...n, text })));
  const reserve = footLines.length ? footLines.reduce((sum, l) => sum + l.size * LINE_HEIGHT, 0) + 10 : 0;
  const body = paginate(blocks.filter((b) => !b.footnote).map(printable_), fonts, reserve);

  // The signature page: after the pages the signature covers, and not part of the signed text.
  const bodySha256 = sha256(signedText(blocks, fonts.regular));
  const signature = crypto.sign(null, signedMessage(payload, bodySha256), key.privateKey).toString("base64");
  const attestation: Attestation = { schema: REPORT_SCHEMA, algorithm: "Ed25519", keyId: key.keyId, payload, bodySha256, signature };
  const line = (text: string, size: number, face: Face, gap: number) => ({ text: printable(text, fonts.regular), size, face, gap });
  const [signaturePage] = paginate(
    [
      line(labels.signatureHeading!, 16, "bold", 8),
      line(`${labels.signatureAlgorithm}: Ed25519`, 10, "regular", 2),
      line(`${labels.signatureKey}: ${key.keyId}`, 9, "mono", 2),
      line(`${labels.documentSha}: ${payload.document.sha256}`, 8, "mono", 2),
      line(`${labels.runId}: ${payload.check.runId}`, 8, "mono", 2),
      line(`${labels.signatureBody}: ${bodySha256}`, 8, "mono", 2),
      line(`${labels.signatureValue}: ${signature}`, 8, "mono", 10),
      line(labels.signatureNote!, 9, "regular", 4),
    ],
    fonts,
    0,
  );
  const pages = [...body, signaturePage!];

  // The footnotes sit at the foot of the first page: their lines, placed bottom-up above the margin.
  const noteHeight = footLines.reduce((sum, l) => sum + l.size * LINE_HEIGHT, 0);
  let noteY = PAGE.margin + noteHeight - (footLines[0]?.size ?? 0);
  const foot = footLines.map((n) => {
    const placed = { ...n, y: noteY };
    noteY -= n.size * LINE_HEIGHT;
    return placed;
  });
  drawPages(doc, fonts, pages, foot);

  const finished = new Date(payload.check.finishedAt);
  doc.setTitle(payload.document.title);
  doc.setSubject(`Yomizaka — ${payload.check.runId}`);
  doc.setProducer("Yomizaka");
  doc.setCreator("Yomizaka");
  doc.setCreationDate(finished);
  doc.setModificationDate(finished);
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of(ATTESTATION_KEY), PDFString.of(Buffer.from(JSON.stringify(attestation), "utf8").toString("base64")));
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, fileSha256: sha256(bytes), attestation };
}

const attestationSchema = z.object({ schema: z.literal(REPORT_SCHEMA), algorithm: z.literal("Ed25519"), keyId: z.string(), payload: reportPayload, bodySha256: z.string().regex(/^[0-9a-f]{64}$/), signature: z.string() });

/** The attestation a PDF carries (not checked), or null — never throws on hostile input. */
export async function attestationOfPdf(bytes: Uint8Array): Promise<Attestation | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    const raw = info.get(PDFName.of(ATTESTATION_KEY));
    if (!(raw instanceof PDFString)) return null;
    return attestationSchema.parse(JSON.parse(Buffer.from(raw.asString(), "base64").toString("utf8"))) as Attestation;
  } catch {
    return null;
  }
}

/** Checks a PDF report like `verifyReport` checks an HTML one — signature first, then the text of the pages, then a specimen is refused. */
export async function verifyPdf(bytes: Uint8Array, key: Pick<SigningKey, "keyId" | "publicKey">, document?: Uint8Array | null): Promise<Verification> {
  const fileSha256 = sha256(bytes);
  const fail = (reason: VerifyFailure): Verification => ({ ok: false, reason, fileSha256 });
  if (!(bytes.length > 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-")) return fail("NOT_A_REPORT");
  const attestation = await attestationOfPdf(bytes);
  if (!attestation) return fail("UNREADABLE");
  if (attestation.keyId !== key.keyId) return fail("UNKNOWN_KEY");
  if (!crypto.verify(null, signedMessage(attestation.payload, attestation.bodySha256), key.publicKey, Buffer.from(attestation.signature, "base64"))) return fail("BAD_SIGNATURE");
  // The pages the signature covers: every page but the last (the visible signature page).
  const { extractText, getDocumentProxy } = await import("unpdf");
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pages = (await extractText(pdf, { mergePages: false })).text as string[];
    // Each page starts with its folio (« 2 / 4 »): it must be the right one for its place, and it is not part of what was signed.
    const body = signedBodyOf(pages);
    if (body === null) return fail("ALTERED");
    text = body;
  } catch {
    return fail("UNREADABLE");
  }
  if (sha256(text) !== attestation.bodySha256) return fail("ALTERED");
  if (attestation.payload.specimen) return fail("SPECIMEN");
  return { ok: true, fileSha256, keyId: attestation.keyId, payload: attestation.payload, documentMatch: document ? sha256(document) === attestation.payload.document.sha256 : null };
}

