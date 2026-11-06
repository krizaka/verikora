import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatDate } from "@/components/console/format";
import { LINK } from "@/lib/applicant-file-rules";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

import { ApplicantFile } from "./ApplicantFile";

const state = (over: Record<string, unknown> = {}) => ({
  status: LINK.open,
  expiresAt: "2026-11-07T15:00:00.000Z",
  types: [
    { id: "pay-stub", fields: [], retentionPolicy: "after-check" },
    { id: "bank-statement", fields: [], retentionPolicy: "after-check" },
  ],
  documents: [] as { id: string; typeId: string; filename: string; sizeBytes: number; signals?: unknown[] }[],
  ...over,
});
const render = (file = state(), consents: ("DOCUMENT_CHECK" | "DOCUMENT_KEEP")[] = [], locale: "en" | "fr" = "en") => {
  const t = locale === "en" ? en : fr;
  return renderToStaticMarkup(
    <ApplicantFile
      token={"t".repeat(30)}
      initial={{ ...file, documents: file.documents.map((d) => ({ signals: [], ...d })) } as never}
      consents={consents}
      noticeVersion="2026-10-30.1"
      words={{
        applicant: t.applicant,
        file: t.applicantFile,
        traces: t.console.analysis.traces,
        levels: t.console.analysis.levels,
        unknown: t.console.errors.UNKNOWN,
      }}
      locale={locale}
      expires="November 7, 2026"
    />,
  );
};
const SUBMIT_OFF = /disabled=""[^>]*data-testid="submit-file"|data-testid="submit-file"[^>]*disabled=""/;
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");

describe("the applicant's page, as drawn (verikora#341)", () => {
  it("shows exactly the documents the request asked for, with what each is for", () => {
    const html = render();
    expect(html).toContain('data-testid="asked-pay-stub"');
    expect(html).toContain('data-testid="asked-bank-statement"');
    expect(html).not.toContain('data-testid="asked-identity-document"');
    expect(text(html)).toContain(en.applicantFile.types["pay-stub"].what);
  });

  it("keeps the drop closed and says why until the applicant consents to the check", () => {
    const html = render();
    expect(html).toContain('data-testid="consent-first"');
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled/);
    expect(html).toContain("disabled");
    const consented = render(state(), ["DOCUMENT_CHECK"]);
    expect(consented).not.toContain('data-testid="consent-first"');
    expect(consented).not.toMatch(/<input[^>]*type="file"[^>]*disabled/);
  });

  it("leaves « Send my file » off until a document is received", () => {
    expect(render(state(), ["DOCUMENT_CHECK"])).toMatch(SUBMIT_OFF);
    const sent = state({ documents: [{ id: "d1", typeId: "pay-stub", filename: "talon.pdf", sizeBytes: 2048 }] });
    const html = render(sent, ["DOCUMENT_CHECK"]);
    expect(html).not.toMatch(SUBMIT_OFF);
    expect(text(html)).toContain("talon.pdf");
  });

  it.each([
    [LINK.revoked, "This link was revoked."],
    [LINK.expired, "This link expired."],
    [LINK.closed, "This file was closed."],
  ] as const)("a %s link says so and offers neither the submission nor a new consent", (status, words) => {
    const html = render(state({ status }), ["DOCUMENT_CHECK"]);
    expect(text(html)).toContain(words);
    expect(html).not.toContain('data-testid="submit-file"');
    expect(html).toMatch(/id="consent-DOCUMENT_KEEP"[^>]*disabled|disabled[^>]*id="consent-DOCUMENT_KEEP"/);
  });

  it("a sent file says it was sent, and still offers the erasure", () => {
    const html = render(state({ status: LINK.used }), ["DOCUMENT_CHECK"]);
    expect(text(html)).toContain(en.applicantFile.submitted);
    expect(html).toContain('data-testid="applicant-erase"');
  });

  it("never shows a placeholder or a retention the file flow does not have", () => {
    expect(text(render())).not.toMatch(/\{[a-z]+\}/);
    expect(text(render(state(), [], "fr"))).not.toMatch(/\{[a-z]+\}/);
  });

  it("speaks French from the French dictionary, with no raw key", () => {
    const html = render(state(), [], "fr");
    expect(text(html)).toContain("Vos documents");
    expect(text(html)).toContain(fr.applicantFile.page.consentFirst);
    expect(text(html)).not.toMatch(/applicantFile\.|applicant\./);
  });

  it("uses no mono face and no error colour outside a refusal", () => {
    const html = render();
    expect(html).not.toContain("font-mono");
    expect(html).not.toMatch(/text-(danger|red)/);
  });

  describe("the traces found in the person's own documents (ADR-0014, verikora#626)", () => {
    const TRACES = [
      {
        id: "PDF-REV-002",
        level: "incohérent",
        observation: "A later save replaced the object that draws the net amount.",
        family: "history",
        evidence: { page: 2, revision: 2 },
        answer: { text: "Signed after I downloaded it.", at: "2026-10-30T15:00:00.000Z" },
      },
      {
        id: "PDF-FONT-001",
        level: "inhabituel",
        observation: "One font appears on one page only.",
        family: "layout",
        evidence: { page: 1 },
        answer: null,
      },
    ];
    const withTraces = (status: string = LINK.open) =>
      state({
        status,
        documents: [{ id: "d1", typeId: "pay-stub", filename: "stub.pdf", sizeBytes: 1000, signals: TRACES }],
      });

    it("lists each trace in the owner's words, with the ordinary explanations and a box holding the answer already given", () => {
      const html = render(withTraces(), ["DOCUMENT_CHECK"]);
      expect(html).toContain('data-testid="trace-PDF-REV-002"');
      expect(html).toContain('data-testid="trace-PDF-FONT-001"');
      const t = text(html);
      expect(t).toContain(en.applicantFile.answer.title);
      expect(t).toContain("A later save replaced the object that draws the net amount.");
      expect(t).toContain(en.console.analysis.traces.ordinary.history);
      expect(t).toContain(en.console.analysis.traces.page.replace("{page}", "2"));
      expect(html).toContain("Signed after I downloaded it.");
      expect(t).toContain(
        en.applicantFile.answer.saved.replace("{date}", formatDate("2026-10-30T15:00:00.000Z", "en")),
      );
    });

    it("says nothing at all when no trace was found, and never a score or a verdict", () => {
      expect(render(state(), ["DOCUMENT_CHECK"])).not.toContain("applicant-traces");
      expect(text(render(withTraces(), ["DOCUMENT_CHECK"]))).not.toMatch(/forged|fake|fraud|score|%/i);
    });

    it("closes the boxes once the link is revoked, and in French reads the same section", () => {
      expect(render(withTraces(LINK.revoked), ["DOCUMENT_CHECK"])).toMatch(/<textarea[^>]*disabled/);
      expect(text(render(withTraces(), ["DOCUMENT_CHECK"], "fr"))).toContain(fr.applicantFile.answer.title);
    });
  });
});
