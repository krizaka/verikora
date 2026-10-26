import { PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { ALIAS_RULES } from "../removed-urls.mjs";
import { generateSigningKeyBase64, parseSigningKey } from "../report-key";
import { signingKey } from "../report-signer";
import { sealRequest } from "./request";
import { attestationOf, contractIdOf, flatten, sealPdf, verifySeal } from "./seal";
import { KEPT_IN, zoneAsked } from "./service";
import { inZone, zonesOfRegion } from "./zone";

const body = {
  partnerId: "orochia",
  documentType: "CREATOR_PARTNERSHIP_CONTRACT_90_10",
  contractPayload: { terms: { split: { creator: 90, platform: 10 }, currency: "CAD" }, clauses: ["a", "b"], title: "Entente de partenariat" },
  parties: [
    { role: "PLATFORM", name: "Plateforme Exemple Inc.", signedAt: "2026-10-17T12:00:00Z" },
    { role: "CREATOR", userId: "c79f-demo", attestationId: "att_demo_1", signedAt: "2026-10-17T12:05:00Z" },
  ],
  complianceRuleset: "PARTNER-FRAMEWORK-1",
};
const request = sealRequest.parse(body);
const when = { contractId: contractIdOf("owner-1", request), sealedAt: "2026-10-17T12:05:02Z", zone: "CA-ON" };

describe("the request", () => {
  it("accepts a contract, its parties and the framework the partner names; the language defaults to French", () => {
    expect(request.locale).toBe("fr");
    expect(sealRequest.safeParse({ ...body, locale: "en" }).success).toBe(true);
  });

  it.each([
    ["no party", { parties: [] }],
    ["a party with neither a name nor an account", { parties: [{ role: "CREATOR", signedAt: "2026-10-17T12:05:00Z" }] }],
    ["a role that is not a role", { parties: [{ role: "creator!", name: "x", signedAt: "2026-10-17T12:05:00Z" }] }],
    ["a signing time that is not a time", { parties: [{ role: "CREATOR", name: "x", signedAt: "yesterday" }] }],
    ["a partner id with capitals", { partnerId: "Orochia" }],
    ["a document type in lower case", { documentType: "contract" }],
    ["a field nobody asked for", { extra: 1 }],
    ["a content over 100 000 bytes", { contractPayload: { blob: "x".repeat(100_001) } }],
  ])("refuses %s", (_label, over) => {
    expect(sealRequest.safeParse({ ...body, ...over }).success).toBe(false);
  });

  it("names the contract by what it is, for whom: a retry is the same contract", () => {
    expect(contractIdOf("owner-1", request)).toMatch(/^ctr_[0-9a-f]{24}$/);
    expect(contractIdOf("owner-1", request)).toBe(contractIdOf("owner-1", sealRequest.parse(body)));
    expect(contractIdOf("owner-2", request)).not.toBe(contractIdOf("owner-1", request));
    expect(contractIdOf("owner-1", sealRequest.parse({ ...body, contractPayload: { other: 1 } }))).not.toBe(contractIdOf("owner-1", request));
  });

  it("lays the content out as path: value lines, keys in order", () => {
    expect(flatten({ b: 1, a: { z: "x", y: [true, null] }, e: [], f: {} })).toEqual(['a.y[0]: true', "a.y[1]: null", 'a.z: "x"', "b: 1", "e: []", "f: {}"]);
    expect(flatten({})).toEqual(["{}"]);
  });
});

describe("a sealed contract", () => {
  it("is a PDF with a folio on every page, a visible signature page and the attestation embedded", async () => {
    const sealed = await sealPdf(request, when, signingKey());
    expect(Buffer.from(sealed.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pages = (await extractText(await getDocumentProxy(new Uint8Array(sealed.bytes)), { mergePages: false })).text as string[];
    expect(pages.length).toBeGreaterThanOrEqual(2);
    pages.forEach((text, i) => expect(text.replace(/\s+/g, "").startsWith(`${i + 1}/${pages.length}`)).toBe(true));
    expect(pages.at(-1)).toContain("Page de signature");
    const body = pages.slice(0, -1).join(" ");
    for (const word of ["CREATOR_PARTNERSHIP_CONTRACT_90_10", "Plateforme Exemple Inc.", "att_demo_1", "terms.split.creator: 90", "PARTNER-FRAMEWORK-1"]) expect(body).toContain(word);
    expect(await attestationOf(sealed.bytes)).toMatchObject({ keyId: sealed.attestation.keyId, signature: sealed.attestation.signature, payload: { contractId: when.contractId, zone: "CA-ON", partnerId: "orochia" } });
  });

  it("says what it attests and what it does not — it never says compliant, approved or that someone's identity or age is verified", async () => {
    for (const locale of ["fr", "en"] as const) {
      const sealed = await sealPdf({ ...request, locale }, when, signingKey());
      const { extractText, getDocumentProxy } = await import("unpdf");
      const text = ((await extractText(await getDocumentProxy(new Uint8Array(sealed.bytes)), { mergePages: true })).text as string).replace(/\s+/g, " ");
      expect(text).toMatch(locale === "fr" ? /ne vérifie ni l’identité de quiconque, ni l’âge/ : /does not verify anyone's identity, the age of anyone/);
      expect(text).not.toMatch(/\bconforme\b|\bcompliant\b|\bapprouvé\b|\bapproved\b/i);
    }
  });

  it("carries the hash of the content in the signed payload, not the content", async () => {
    const sealed = await sealPdf(request, when, signingKey());
    expect(sealed.attestation.payload.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sealed.attestation)).not.toContain("Entente de partenariat");
  });

  it("is deterministic: the same request, id, day and key give the same bytes", async () => {
    const [a, b] = [await sealPdf(request, when, signingKey()), await sealPdf(request, when, signingKey())];
    expect(a.sha256).toBe(b.sha256);
    expect((await sealPdf(request, { ...when, sealedAt: "2026-10-17T12:05:03Z" }, signingKey())).sha256).not.toBe(a.sha256);
  });

  it("runs over several pages for a long content, and still verifies", async () => {
    const long = sealRequest.parse({ ...body, contractPayload: { clauses: Array.from({ length: 120 }, (_, i) => `Clause ${i + 1} de l’entente.`) } });
    const sealed = await sealPdf(long, { ...when, contractId: contractIdOf("owner-1", long) }, signingKey());
    expect(await PDFDocument.load(sealed.bytes).then((d) => d.getPageCount())).toBeGreaterThanOrEqual(4);
    expect(await verifySeal(sealed.bytes, signingKey())).toMatchObject({ valid: true });
  });
});

describe("checking a seal", () => {
  it("verifies with the key", async () => {
    const sealed = await sealPdf(request, when, signingKey());
    expect(await verifySeal(sealed.bytes, signingKey())).toMatchObject({ valid: true, attestation: { payload: { contractId: when.contractId } } });
  });

  it("fails with UNKNOWN_KEY for another key and BAD_SIGNATURE when the signed payload is edited", async () => {
    const sealed = await sealPdf(request, when, signingKey());
    expect(await verifySeal(sealed.bytes, parseSigningKey(generateSigningKeyBase64(), false))).toEqual({ valid: false, reason: "UNKNOWN_KEY" });
    const doc = await PDFDocument.load(sealed.bytes);
    const edited = { ...sealed.attestation, payload: { ...sealed.attestation.payload, documentType: "OTHER_CONTRACT" } };
    doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).set(PDFName.of("YomizakaContractAttestation"), PDFString.of(Buffer.from(JSON.stringify(edited)).toString("base64")));
    expect(await verifySeal(await doc.save(), signingKey())).toEqual({ valid: false, reason: "BAD_SIGNATURE" });
  });

  it("fails with ALTERED when a word on a page changes, however genuine the attestation", async () => {
    const forged = await sealPdf(sealRequest.parse({ ...body, complianceRuleset: "OTHER-FRAMEWORK" }), when, signingKey());
    const genuine = (await sealPdf(request, when, signingKey())).attestation;
    const doc = await PDFDocument.load(forged.bytes);
    doc.context.lookup(doc.context.trailerInfo.Info, PDFDict).set(PDFName.of("YomizakaContractAttestation"), PDFString.of(Buffer.from(JSON.stringify(genuine)).toString("base64")));
    expect(await verifySeal(await doc.save(), signingKey())).toEqual({ valid: false, reason: "ALTERED" });
  });

  it("fails with ALTERED when a page is moved (the folio says where it belongs)", async () => {
    const long = sealRequest.parse({ ...body, contractPayload: { clauses: Array.from({ length: 120 }, (_, i) => `Clause ${i + 1} de l’entente.`) } });
    const sealed = await sealPdf(long, { ...when, contractId: contractIdOf("owner-1", long) }, signingKey());
    const doc = await PDFDocument.load(sealed.bytes);
    const moved = doc.getPage(2);
    doc.removePage(2);
    doc.insertPage(1, moved);
    expect(await verifySeal(await doc.save(), signingKey())).toEqual({ valid: false, reason: "ALTERED" });
  });

  it("never throws on hostile input: not a PDF, a PDF with no attestation, a report's PDF", async () => {
    expect(await verifySeal(new TextEncoder().encode("hello"), signingKey())).toEqual({ valid: false, reason: "NOT_A_SEAL" });
    expect(await verifySeal(await (await PDFDocument.create()).save(), signingKey())).toEqual({ valid: false, reason: "NOT_A_SEAL" });
  });
});

describe("the data zone", () => {
  it("knows the province of the regions it knows, and no zone for one it does not", () => {
    expect(zonesOfRegion("tor1")).toEqual(["CA", "CA-ON"]);
    expect(zonesOfRegion("ca-central-1")).toEqual(["CA", "CA-QC"]);
    expect(zonesOfRegion("bhs")).toEqual(["CA", "CA-QC"]);
    expect(zonesOfRegion("ca-central")).toEqual(["CA"]);
    expect(zonesOfRegion("nyc3")).toEqual([]);
    expect(zonesOfRegion(null)).toEqual([]);
    expect(inZone("tor1", "CA")).toBe(true);
    expect(inZone("tor1", "CA-QC")).toBe(false);
  });

  it("keeps the sealed file in the database's region today: CA is answered, CA-QC is refused, never claimed", () => {
    expect(KEPT_IN().region).toBe("tor1");
    expect(zoneAsked(null)).toBe("CA");
    expect(zoneAsked(" ca-on ")).toBe("CA-ON");
    expect(() => zoneAsked("CA-QC")).toThrowError(expect.objectContaining({ status: 409, body: expect.objectContaining({ code: "ZONE_UNAVAILABLE" }) }));
    expect(() => zoneAsked("FR")).toThrowError(expect.objectContaining({ status: 400, body: expect.objectContaining({ code: "BAD_ZONE" }) }));
    expect(() => zoneAsked("CA-QUE")).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("the short address of the public check answers 308 to the route", () => {
    expect(ALIAS_RULES).toEqual([{ source: "/verify/contract/:sha256([0-9a-f]{64})", destination: "/api/verify/contract/:sha256", permanent: true }]);
  });
});
