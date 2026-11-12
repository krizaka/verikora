import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { recordedRun } from "./recorded-runs";
import { buildPayload, issueReport, sha256, verifyReport } from "./report";
import { reportLabels } from "./report-labels";
import { signingKey } from "./report-signer";

/**
 * ADR-0002 §Specimens: a report signed with Verikora's key is an attestation. No public route may serve one, and nothing
 * public may carry the key material or the fingerprint of one. A sample is a visual specimen, never a signed file.
 */
const ROOT = join(__dirname, "..");
const routes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) =>
    statSync(join(dir, n)).isDirectory() ? routes(join(dir, n)) : n === "route.ts" ? [join(dir, n)] : [],
  );
const API = join(ROOT, "app/api");
const isPrivate = (src: string) => /requireSession|requireAdmin|apiCaller/.test(src);
/**
 * The one public check there is: a sealed contract, asked by the SHA-256 of its file (verikora#71). It serves no signed artifact — only whether
 * Verikora sealed that hash, when and under which key — and never a report: it may read the seal's key, nothing of the reports' signing.
 */
const CONTRACT_CHECK = join(API, "verify/contract/[sha256]/route.ts");

/**
 * The owner link's PDF (verikora#481): not public — the token of a live, unrevoked link the manager created is the credential, each download is logged,
 * and what it signs is the redacted owner report of that one file. It is the only route outside a session that may sign; no specimen of it exists.
 */
const OWNER_PDF = join(API, "rapport/[token]/pdf/route.ts");

describe("no public route serves a signed artifact", () => {
  it("the owner link's PDF is delivered only through a live link (openShare), as an attachment that is never cached", () => {
    const src = readFileSync(OWNER_PDF, "utf8");
    expect(src).toContain("openShare(");
    expect(src).toContain("no-store");
    expect(src).not.toMatch(/issueReport|recordedReport|showcaseReport|reportFor|specimen/i);
  });

  it("every route that is not behind a session leaves the signing code alone", () => {
    const publicRoutes = routes(API).filter(
      (f) => !isPrivate(readFileSync(f, "utf8")) && f !== CONTRACT_CHECK && f !== OWNER_PDF,
    );
    expect(publicRoutes.length).toBeGreaterThan(0);
    for (const f of publicRoutes) {
      // A vendor's webhook checks the vendor's signature (a payment, a bounce): the word is theirs, not a report's. It still never touches ours.
      const vendorWebhook = f.startsWith(join(API, "webhooks"));
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        vendorWebhook
          ? /report-signer|issueReport|recordedReport|showcaseReport|reportFor|attestation/i
          : /issueReport|recordedReport|showcaseReport|signingKey|reportFor|attestation|signature/i,
      );
    }
  });

  it("the public check of a sealed contract answers about a hash and serves no file, no report and no personal information", () => {
    const src = readFileSync(CONTRACT_CHECK, "utf8");
    expect(src).not.toMatch(
      /issueReport|recordedReport|showcaseReport|reportFor|reportPdfFor|new Response\(|content-disposition/i,
    );
    expect(src).not.toMatch(/parties|\.name\b|userId|attestationId|contractPayload/);
    expect(src).toContain("limit(");
  });

  it("the two public report downloads are gone (the routes do not exist: 404)", () => {
    expect(existsSync(join(API, "recorded-runs"))).toBe(false);
    expect(existsSync(join(API, "showcase/report"))).toBe(false);
  });

  it("the public components never import the signing modules", () => {
    for (const f of ["components/home/HeroFinding.tsx", "app/[locale]/page.tsx"]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(
        /report-signer|issueReport|recordedReport|recordedRunView|\/report\?lang|api\/recorded-runs/,
      );
    }
  });
});

describe("a specimen is never an attestation", () => {
  const doc = { sha256: sha256("x"), filename: "f.txt", title: "T", sizeBytes: 1, pages: null };
  const analysis = {
    id: "a",
    studio: "compliance-check" as const,
    status: "succeeded" as const,
    runId: "r1",
    blueprintVersion: "1",
    inputs: {},
    report: {
      rulesetId: "qc",
      rulesetVersion: "1",
      jurisdiction: "QC",
      asOf: "2026-10-17",
      findings: [{ ruleId: "x", severity: "BLOCKING", verdict: "FAIL", explanation: "e" }],
    },
    error: null,
    createdAt: "2026-10-17T10:00:00.000Z",
    finishedAt: "2026-10-17T10:00:01.000Z",
  };

  it("verification rejects a payload marked specimen, even with a valid signature", () => {
    const payload = { ...buildPayload(doc, analysis, "en"), specimen: true as const };
    const issued = issueReport(payload, reportLabels("en"), signingKey());
    expect(verifyReport(issued.html, signingKey())).toMatchObject({ ok: false, reason: "SPECIMEN" });
  });

  it("and still verifies a real report", () => {
    const issued = issueReport(buildPayload(doc, analysis, "en"), reportLabels("en"), signingKey());
    expect(verifyReport(issued.html, signingKey())).toMatchObject({ ok: true });
  });
});

describe("the samples are obviously fictitious", () => {
  it("every named party carries « (fictif) »", () => {
    for (const side of ["tenant", "landlord"] as const) {
      const text = recordedRun(side).document.text;
      for (const name of text.match(/(?:Monsieur|Madame) [A-ZÉ][\wéèï-]+ [A-ZÉ][\wéèï-]+/g) ?? [])
        expect(text, name).toContain(`${name} (fictif)`);
    }
  });

  it("the signed PDF is only issued behind a session, to the owner", () => {
    const route = readFileSync(join(API, "documents/[id]/analyses/[analysisId]/report/route.ts"), "utf8");
    expect(route).toContain("requireSession");
    expect(route.indexOf("requireSession")).toBeLessThan(route.indexOf("reportPdfFor"));
  });
});
