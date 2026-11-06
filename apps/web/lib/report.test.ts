import crypto from "node:crypto";

import type { Analysis, DocumentDetail } from "@verikora/core";
import { describe, expect, it } from "vitest";

import { buildPayload, canonicalJson, issueReport, renderBody, ReportError, sha256, verifyReport } from "./report";
import { generateSigningKeyBase64, parseSigningKey } from "./report-key";
import { reportLabels } from "./report-labels";

// A test fixture in the shape of a compliance report (packages/core `complianceReport`); not a recorded Sovkora run.
const DOC: Pick<DocumentDetail, "sha256" | "filename" | "title" | "sizeBytes" | "pages"> = {
  sha256: sha256("the lease"),
  filename: "bail-saint-denis.pdf",
  title: "Bail Saint-Denis",
  sizeBytes: 48_213,
  pages: 3,
};
const ANALYSIS: Analysis = {
  id: "11111111-1111-4111-8111-111111111111",
  studio: "compliance-check",
  status: "succeeded",
  runId: "8f6b1c2e-1d2c-4b8a-9a55-0d1e2f3a4b5c",
  blueprintVersion: "1.1.1",
  inputs: { jurisdiction: "QC", asOf: "2026-10-14" },
  report: {
    rulesetId: "qc-residential-lease",
    rulesetVersion: "2026.2",
    rulesetRevision: 4,
    jurisdiction: "QC",
    asOf: "2026-10-14",
    reviewStatus: "TO_REVIEW_BY_LAWYER",
    summary: { byVerdict: { FAIL: 1, PASS: 1 }, blockingFailures: 1, rulesEvaluated: 2 },
    findings: [
      {
        ruleId: "qc.no-children-clause",
        title: "Clause interdisant les enfants",
        severity: "BLOCKING",
        verdict: "FAIL",
        citation: "C.c.Q., art. 1899",
        explanation: "Une telle clause est réputée non écrite <b>.",
        evidenceSpan: { start: 10, end: 62, quote: "Il est interdit d'avoir des enfants dans le logement." },
      },
      {
        ruleId: "qc.deposit",
        severity: "BLOCKING",
        verdict: "PASS",
        explanation: "Aucun dépôt en sus du premier loyer.",
        evidenceSpan: null,
      },
    ],
  },
  error: null,
  createdAt: "2026-10-14T15:00:00.000Z",
  finishedAt: "2026-10-14T15:00:41.000Z",
};

const key = parseSigningKey(generateSigningKeyBase64());
const other = parseSigningKey(generateSigningKeyBase64());
const labels = reportLabels("fr");
const issue = () => issueReport(buildPayload(DOC, ANALYSIS, "fr"), labels, key);

describe("the report's payload", () => {
  it("carries the document hash, the check, the run id and every finding with its passage and article", () => {
    const p = buildPayload(DOC, ANALYSIS, "fr");
    expect(p.document.sha256).toBe(DOC.sha256);
    expect(p.check).toMatchObject({
      runId: ANALYSIS.runId,
      studioVersion: "1.1.1",
      jurisdiction: "QC",
      rulesetVersion: "2026.2",
      finishedAt: ANALYSIS.finishedAt,
    });
    expect(p.findings[0]).toMatchObject({
      ruleId: "qc.no-children-clause",
      citation: "C.c.Q., art. 1899",
      quote: "Il est interdit d'avoir des enfants dans le logement.",
      verdict: "FAIL",
    });
    expect(p.findings[1]).toMatchObject({ quote: null, citation: null });
  });

  it("refuses what is not a finished compliance check", () => {
    expect(() => buildPayload(DOC, { ...ANALYSIS, status: "running" }, "en")).toThrow(ReportError);
    expect(() => buildPayload(DOC, { ...ANALYSIS, studio: "document-authenticity" }, "en")).toThrow(ReportError);
    expect(() => buildPayload(DOC, { ...ANALYSIS, runId: null }, "en")).toThrow(ReportError);
    expect(() => buildPayload(DOC, { ...ANALYSIS, report: null }, "en")).toThrow(ReportError);
    expect(() => buildPayload(DOC, { ...ANALYSIS, inputs: { seeded: "true" } }, "en")).toThrow(ReportError);
  });
});

describe("determinism", () => {
  it("gives the same bytes, the same fingerprint and the same signature for the same check", () => {
    const a = issue();
    const b = issue();
    expect(b.html).toBe(a.html);
    expect(b.fileSha256).toBe(a.fileSha256);
    expect(b.attestation.signature).toBe(a.attestation.signature);
    expect(a.fileSha256).toBe(sha256(a.html));
  });

  it("is independent of key order in the stored report (canonical JSON)", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("changes when anything the report states changes", () => {
    const changed = issueReport(buildPayload(DOC, { ...ANALYSIS, runId: "another-run" }, "fr"), labels, key);
    expect(changed.fileSha256).not.toBe(issue().fileSha256);
  });
});

describe("the report's content", () => {
  const html = issue().html;
  it("prints the document hash, the rules version, the date, the run id, each passage and article — escaped", () => {
    for (const needle of [
      DOC.sha256,
      "2026.2",
      "2026-10-14T15:00:41.000Z",
      ANALYSIS.runId!,
      "Studio",
      "C.c.Q., art. 1899",
      "Il est interdit d&#39;avoir".replace("&#39;", "'"),
      "réputée non écrite &lt;b&gt;.",
    ]) {
      expect(html).toContain(needle);
    }
    expect(html).not.toContain("<b>.");
    expect(html).toContain('lang="fr"');
  });
  it("says what it guarantees and what it does not, in the report's language", () => {
    expect(renderBody(buildPayload(DOC, ANALYSIS, "en"), reportLabels("en"))).toContain("no blockchain");
    expect(html).toContain("chaîne de blocs");
  });
});

describe("verification", () => {
  it("accepts an untouched report and tells which document it is about", () => {
    const { html, fileSha256 } = issue();
    const bytes = Buffer.from("the lease");
    expect(verifyReport(html, key, bytes)).toMatchObject({
      ok: true,
      fileSha256,
      keyId: key.keyId,
      documentMatch: true,
    });
    expect(verifyReport(html, key, Buffer.from("another lease"))).toMatchObject({ ok: true, documentMatch: false });
    expect(verifyReport(html, key)).toMatchObject({ ok: true, documentMatch: null });
  });

  it("accepts a pasted copy whose line ends became CRLF", () => {
    expect(verifyReport(issue().html.replace(/\n/g, "\r\n"), key).ok).toBe(true);
  });

  it("fails a report whose visible text was edited (a verdict, a word, a space)", () => {
    const { html } = issue();
    for (const [from, to] of [
      ["Point non respecté", "Point respecté"],
      ["art. 1899", "art. 1900"],
      ["8f6b1c2e", "8f6b1c2f"],
      ["</body>", " </body>"],
    ] as const) {
      expect(html).toContain(from);
      expect(verifyReport(html.replace(from, to), key)).toMatchObject({ ok: false, reason: "ALTERED" });
    }
  });

  it("fails a report whose signed payload was edited (document hash, run id, a finding)", () => {
    const { html, attestation } = issue();
    const tamper = (mutate: (a: typeof attestation) => void) => {
      const copy = structuredClone(attestation);
      mutate(copy);
      return html.replace(
        /(<script type="application\/json" id="verikora-attestation">)[^<]*(<\/script>)/,
        `$1${JSON.stringify(copy).replace(/</g, "\\u003c")}$2`,
      );
    };
    expect(
      verifyReport(
        tamper((a) => (a.payload.document.sha256 = sha256("forged"))),
        key,
      ),
    ).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    expect(
      verifyReport(
        tamper((a) => (a.payload.check.runId = "forged-run")),
        key,
      ),
    ).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    expect(
      verifyReport(
        tamper((a) => (a.payload.findings[0]!.verdict = "PASS")),
        key,
      ),
    ).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    expect(
      verifyReport(
        tamper((a) => (a.bodySha256 = sha256("x"))),
        key,
      ),
    ).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("fails a report re-signed by another key, a swapped signature, a second block, and a body re-hashed by a forger", () => {
    const { html, attestation } = issue();
    const forged = issueReport(attestation.payload, labels, other);
    expect(verifyReport(forged.html, key)).toMatchObject({ ok: false, reason: "UNKNOWN_KEY" });
    const relabeled = forged.html.replace(other.keyId, key.keyId);
    expect(verifyReport(relabeled, key)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
    expect(
      verifyReport(
        html.replace(
          "</body>",
          `${html.match(/<script type="application\/json" id="verikora-attestation">[^<]*<\/script>/)![0]}</body>`,
        ),
        key,
      ),
    ).toMatchObject({ ok: false });
    // A forger edits the text AND recomputes bodySha256, but cannot recompute the signature.
    const edited = html.replace("Point non respecté", "Point respecté");
    const rehashed = edited.replace(
      /(<script type="application\/json" id="verikora-attestation">)([^<]*)(<\/script>)/,
      (_m, a: string, json: string, c: string) => {
        const att = JSON.parse(json);
        att.bodySha256 = sha256(
          edited.replace(
            /<script type="application\/json" id="verikora-attestation">[^<]*<\/script>/,
            "<!--verikora-attestation-->",
          ),
        );
        return a + JSON.stringify(att).replace(/</g, "\\u003c") + c;
      },
    );
    expect(verifyReport(rehashed, key)).toMatchObject({ ok: false, reason: "BAD_SIGNATURE" });
  });

  it("answers, never throws, on what is not a report", () => {
    expect(verifyReport("", key)).toMatchObject({ ok: false, reason: "NOT_A_REPORT" });
    expect(verifyReport("<html>hello</html>", key)).toMatchObject({ ok: false, reason: "NOT_A_REPORT" });
    expect(verifyReport('<script type="application/json" id="verikora-attestation">{nope</script>', key)).toMatchObject(
      { ok: false, reason: "UNREADABLE" },
    );
    expect(
      verifyReport('<script type="application/json" id="verikora-attestation">{"schema":"x"}</script>', key),
    ).toMatchObject({ ok: false, reason: "UNREADABLE" });
  });

  it("a signature can be checked without the site: Ed25519 over the canonical text", () => {
    const { attestation } = issue();
    const message = Buffer.from(
      canonicalJson({ bodySha256: attestation.bodySha256, payload: attestation.payload }),
      "utf8",
    );
    expect(crypto.verify(null, message, key.publicKey, Buffer.from(attestation.signature, "base64"))).toBe(true);
  });
});

describe("the signing key", () => {
  it("is Ed25519 and its id is derived from the public key", () => {
    expect(key.keyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(parseSigningKey(generateSigningKeyBase64()).keyId).not.toBe(key.keyId);
  });
  it("refuses a value that is not a key, without echoing it", () => {
    expect(() => parseSigningKey("not-a-key-SECRETVALUE")).toThrow(/not a base64 PKCS#8/);
    try {
      parseSigningKey("not-a-key-SECRETVALUE");
    } catch (e) {
      expect(String(e)).not.toContain("SECRETVALUE");
    }
    const rsa = crypto
      .generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64");
    expect(() => parseSigningKey(rsa)).toThrow(/Ed25519/);
  });
});
