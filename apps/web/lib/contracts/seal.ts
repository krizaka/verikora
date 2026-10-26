import crypto from "node:crypto";

import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { z } from "zod";

import { format, getDictionary, type Locale } from "../i18n";
import { drawPages, embedFonts, type Face, paginate, printable, signedBodyOf } from "../pdf-layout";
import { canonicalJson, sha256 } from "../report";
import type { SigningKey } from "../report-key";
import { SITE_URL } from "../site";
import type { SealParty, SealRequest } from "./request";

/*
 * A sealed contract (yomizaka#71): a partner platform sends a contract's content and its parties; Yomizaka renders it as a PDF —
 * the content, the parties, what the seal says and does not — and signs it, with the same Ed25519 key and the same grammar as the
 * signed reports: a folio on each page, a visible signature page, the attestation embedded in the file. What is signed is the
 * canonical JSON `payload` (the content's SHA-256, the parties, the day, the zone) and the SHA-256 of the text of the pages.
 *
 * It seals; it does not verify. Not an identity, not an age, not the validity of the contract in law, not the partner's
 * statements (`complianceRuleset` is shown as the partner's own).
 */
export const CONTRACT_SCHEMA = "yomizaka.contract/1";
export const CONTRACT_ATTESTATION_KEY = "YomizakaContractAttestation";

export const contractPayload = z.object({
  schema: z.literal(CONTRACT_SCHEMA),
  contractId: z.string(),
  partnerId: z.string(),
  documentType: z.string(),
  complianceRuleset: z.string(),
  /** SHA-256 of the canonical JSON of the content the partner sent. */
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  parties: z.array(z.object({ role: z.string(), name: z.string().optional(), userId: z.string().optional(), attestationId: z.string().optional(), signedAt: z.string() })),
  sealedAt: z.string(),
  zone: z.string(),
  lang: z.enum(["en", "fr"]),
});
export type ContractPayload = z.infer<typeof contractPayload>;

export interface ContractAttestation {
  schema: typeof CONTRACT_SCHEMA;
  algorithm: "Ed25519";
  keyId: string;
  payload: ContractPayload;
  bodySha256: string;
  /** base64 Ed25519 signature of `canonicalJson({ bodySha256, payload })`. */
  signature: string;
}

const attestationSchema = z.object({ schema: z.literal(CONTRACT_SCHEMA), algorithm: z.literal("Ed25519"), keyId: z.string(), payload: contractPayload, bodySha256: z.string().regex(/^[0-9a-f]{64}$/), signature: z.string() });
const messageOf = (payload: ContractPayload, bodySha256: string) => Buffer.from(canonicalJson({ bodySha256, payload }), "utf8");

/** The contract's id: the same request from the same account is the same contract, so a partner's retry seals nothing twice. */
export const contractIdOf = (ownerId: string, request: SealRequest): string =>
  `ctr_${crypto.createHash("sha256").update(canonicalJson({ ownerId, partnerId: request.partnerId, documentType: request.documentType, contractPayload: request.contractPayload, parties: request.parties })).digest("hex").slice(0, 24)}`;

/** The payload the seal signs, from the request (the content is hashed, not copied: the file carries the content, the attestation its hash). */
export function payloadOf(request: SealRequest, input: { contractId: string; sealedAt: string; zone: string }): ContractPayload {
  const parties = request.parties.map((p: SealParty) => ({ role: p.role, ...(p.name ? { name: p.name } : {}), ...(p.userId ? { userId: p.userId } : {}), ...(p.attestationId ? { attestationId: p.attestationId } : {}), signedAt: p.signedAt }));
  return { schema: CONTRACT_SCHEMA, contractId: input.contractId, partnerId: request.partnerId, documentType: request.documentType, complianceRuleset: request.complianceRuleset, contentSha256: sha256(canonicalJson(request.contractPayload)), parties, sealedAt: input.sealedAt, zone: input.zone, lang: request.locale };
}

/** The content as `path: value` lines, keys in order: indentation does not survive a PDF's wrapping, a path does. */
export function flatten(value: unknown, path = ""): string[] {
  if (path === "" && value !== null && typeof value === "object" && Object.keys(value).length === 0) return ["{}"];
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => flatten(v, `${path}[${i}]`)) : [`${path}: []`];
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.length ? entries.flatMap(([k, v]) => flatten(v, path ? `${path}.${k}` : k)) : [`${path}: {}`];
  }
  return [`${path}: ${JSON.stringify(value)}`];
}

interface Block {
  text: string;
  size: number;
  face: Face;
  gap: number;
}
const block = (text: string, size: number, face: Face = "regular", gap = 4): Block => ({ text, size, face, gap });

/** The pages' text, in reading order: what the signature covers. */
export function contractBlocks(payload: ContractPayload, content: unknown, locale: Locale): Block[] {
  const w = getDictionary(locale).contractSeal;
  const party = (p: ContractPayload["parties"][number]) =>
    block([`${p.role}`, p.name ? `${w.partyName}: ${p.name}` : "", p.userId ? `${w.partyUser}: ${p.userId}` : "", p.attestationId ? `${w.partyAttestation}: ${p.attestationId}` : "", `${w.partySignedAt}: ${p.signedAt}`].filter(Boolean).join(" · "), 9);
  return [
    block(w.eyebrow, 8, "regular", 2),
    block(payload.documentType, 18, "bold", 6),
    block(`${w.contractId}: ${payload.contractId}`, 9, "mono"),
    block(`${w.partner}: ${payload.partnerId}`, 9),
    block(`${w.ruleset}: ${payload.complianceRuleset}`, 9),
    block(`${w.sealedAt}: ${payload.sealedAt}`, 9),
    block(`${w.zone}: ${payload.zone}`, 9, "regular", 8),
    block(w.parties, 12, "bold", 2),
    ...payload.parties.map(party),
    block(w.payloadHeading, 12, "bold", 2),
    block(`${w.payloadSha}: ${payload.contentSha256}`, 8, "mono", 4),
    ...flatten(content).map((line) => block(line, 8, "mono", 1)),
    block(w.guaranteeHeading, 12, "bold", 2),
    block(w.guarantees, 9),
    block(w.notGuaranteed, 9),
    block(format(w.verify, { url: `${SITE_URL}/verify/contract/` }), 9),
  ];
}

export interface SealedPdf {
  bytes: Uint8Array;
  /** SHA-256 of the file as delivered: what the partner keeps and the public check asks for. */
  sha256: string;
  attestation: ContractAttestation;
}

/** Lays out, hashes the text, signs, embeds. Deterministic: the same request, id, day and key give the same bytes. */
export async function sealPdf(request: SealRequest, input: { contractId: string; sealedAt: string; zone: string }, key: SigningKey): Promise<SealedPdf> {
  const payload = payloadOf(request, input);
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const blocks = contractBlocks(payload, request.contractPayload, request.locale).map((b) => ({ ...b, text: printable(b.text, fonts.regular) }));
  const body = paginate(blocks, fonts, 0);
  const bodySha256 = sha256(blocks.map((b) => b.text).join("").replace(/\s+/g, ""));
  const signature = crypto.sign(null, messageOf(payload, bodySha256), key.privateKey).toString("base64");
  const attestation: ContractAttestation = { schema: CONTRACT_SCHEMA, algorithm: "Ed25519", keyId: key.keyId, payload, bodySha256, signature };

  const r = getDictionary(request.locale).report;
  const line = (text: string, size: number, face: Face, gap: number) => block(printable(text, fonts.regular), size, face, gap);
  const [signaturePage] = paginate(
    [
      line(r.signatureHeading, 16, "bold", 8),
      line(`${r.signatureAlgorithm}: Ed25519`, 10, "regular", 2),
      line(`${r.signatureKey}: ${key.keyId}`, 9, "mono", 2),
      line(`${getDictionary(request.locale).contractSeal.payloadSha}: ${payload.contentSha256}`, 8, "mono", 2),
      line(`${r.signatureBody}: ${bodySha256}`, 8, "mono", 2),
      line(`${r.signatureValue}: ${signature}`, 8, "mono", 10),
    ],
    fonts,
    0,
  );
  drawPages(doc, fonts, [...body, signaturePage!]);

  const sealed = new Date(payload.sealedAt);
  doc.setTitle(payload.documentType);
  doc.setSubject(`Yomizaka — ${payload.contractId}`);
  doc.setProducer("Yomizaka");
  doc.setCreator("Yomizaka");
  doc.setCreationDate(sealed);
  doc.setModificationDate(sealed);
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.set(PDFName.of(CONTRACT_ATTESTATION_KEY), PDFString.of(Buffer.from(JSON.stringify(attestation), "utf8").toString("base64")));
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, sha256: sha256(bytes), attestation };
}

export type SealVerdict =
  | { valid: true; attestation: ContractAttestation }
  | { valid: false; reason: "NOT_A_SEAL" | "UNKNOWN_KEY" | "BAD_SIGNATURE" | "ALTERED" };

/** The attestation a file carries (not checked), or null — never throws on hostile input. */
export async function attestationOf(bytes: Uint8Array): Promise<ContractAttestation | null> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const raw = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).get(PDFName.of(CONTRACT_ATTESTATION_KEY));
    if (!(raw instanceof PDFString)) return null;
    return attestationSchema.parse(JSON.parse(Buffer.from(raw.asString(), "base64").toString("utf8")));
  } catch {
    return null;
  }
}

/** Checks a sealed file: the signature first, then the text of its pages against the signed hash. */
export async function verifySeal(bytes: Uint8Array, key: Pick<SigningKey, "keyId" | "publicKey">): Promise<SealVerdict> {
  const attestation = await attestationOf(bytes);
  if (!attestation) return { valid: false, reason: "NOT_A_SEAL" };
  if (attestation.keyId !== key.keyId) return { valid: false, reason: "UNKNOWN_KEY" };
  if (!crypto.verify(null, messageOf(attestation.payload, attestation.bodySha256), key.publicKey, Buffer.from(attestation.signature, "base64"))) return { valid: false, reason: "BAD_SIGNATURE" };
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pages = (await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false })).text as string[];
    const body = signedBodyOf(pages);
    if (body === null || sha256(body) !== attestation.bodySha256) return { valid: false, reason: "ALTERED" };
  } catch {
    return { valid: false, reason: "ALTERED" };
  }
  return { valid: true, attestation };
}
