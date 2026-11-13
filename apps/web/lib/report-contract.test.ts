import { describe, expect, it } from "vitest";

import landlord from "../content/recorded-runs/landlord.json";
import tenant from "../content/recorded-runs/tenant.json";
import {
  checkReportOutput,
  normaliseQuote,
  REPORT_CODE,
  type ReportOutputs,
  validateRefusedWord,
} from "./report-contract";

type Loose = { summary?: { blockingFailures: number }; facts?: unknown; findings: Record<string, unknown>[] } & Record<
  string,
  unknown
>;

type Recording = { document: { text: string }; run: { outputs: ReportOutputs } };
const WORDS = ["fraud", "liar", "reject", "fraude", "menteur"];

/** The recorded report, changed by `edit`, with the text it was read from. */
function recorded(side: Recording, edit?: (report: Loose) => void) {
  const report = JSON.parse(side.run.outputs.find((o) => o.key === "report")!.value!);
  edit?.(report);
  return { outputs: [{ key: "report", value: JSON.stringify(report) }], text: side.document.text };
}
const check = (r: { outputs: ReportOutputs; text: string }, words = WORDS) =>
  checkReportOutput({ studio: "compliance-check", outputs: r.outputs, documentText: r.text, refusedWords: words });

describe.each([
  ["tenant", tenant],
  ["landlord", landlord],
])("the recorded %s run", (_side, side) => {
  it("is a valid output: the report is shown", () => {
    const result = check(recorded(side as unknown as Recording));
    expect(result.ok).toBe(true);
    expect(result.ok && result.report).toHaveProperty("findings");
  });
});

describe("REPORT_SCHEMA: an output that is not the pinned schema is never a page", () => {
  it.each([
    ["no report at all", () => ({ outputs: [], text: "x" })],
    ["a report that is not JSON", () => ({ outputs: [{ key: "report", value: "{nope" }], text: "x" })],
    ["a 2.x report without its summary", () => recorded(tenant as unknown as Recording, (r) => void delete r.summary)],
    [
      "a finding without a verdict",
      () => recorded(tenant as unknown as Recording, (r) => void delete r.findings[0]!.verdict),
    ],
    [
      "a blocking count that is negative",
      () => recorded(tenant as unknown as Recording, (r) => void (r.summary!.blockingFailures = -1)),
    ],
  ])("%s", (_name, make) => {
    expect(check(make())).toMatchObject({ ok: false, code: REPORT_CODE.schema });
  });
});

describe("REPORT_CITATION: every cited passage is in the stored text", () => {
  it("refuses a quote the document does not say", () => {
    const r = recorded(tenant as unknown as Recording, (rep) => {
      rep.findings[0]!.evidenceSpan = { start: 0, end: 9, quote: "ce passage n'existe pas dans le bail" };
    });
    expect(check(r)).toMatchObject({ ok: false, code: REPORT_CODE.citation });
  });
  it("refuses a quote of a figure the document does not say", () => {
    const r = recorded(tenant as unknown as Recording, (rep) => {
      rep.facts = { rent: { status: "found", cents: 100000, evidenceSpan: { quote: "9 999,99 $" } } };
    });
    expect(check(r)).toMatchObject({ ok: false, code: REPORT_CODE.citation });
  });
  it("accepts the pack's own typography: case, spaces, dashes, curly quotes", () => {
    const text = "Le  LOCATEUR s’engage —  à ceci.";
    expect(normaliseQuote("le locateur s'engage - à ceci.")).toBe(normaliseQuote(text));
    const r = recorded(tenant as unknown as Recording, (rep) => {
      for (const f of rep.findings) {
        f.evidenceSpan = null;
      }
      delete rep.facts;
      rep.findings[0]!.evidenceSpan = { quote: "locateur s'engage - à ceci" };
    });
    expect(check({ ...r, text })).toMatchObject({ ok: true });
  });
  it("never finds an empty quote in a text", () => {
    const r = recorded(tenant as unknown as Recording, (rep) => {
      rep.findings[0]!.evidenceSpan = { quote: "   " };
    });
    expect(check(r)).toMatchObject({ ok: false, code: REPORT_CODE.citation });
  });
});

describe("REPORT_WORDING: signals, never a verdict", () => {
  it.each([
    ["an explanation", (r: Loose) => void (r.findings[0]!.explanation = "This tenant is a liar.")],
    ["a title", (r: Loose) => void (r.findings[0]!.title = "Possible FRAUD")],
    [
      "a French phrase with an accent folded",
      (r: Loose) => void (r.findings[0]!.explanation = "Un locataire menteur."),
    ],
  ])("refuses a refused word in %s", (_name, edit) => {
    expect(check(recorded(tenant as unknown as Recording, edit))).toMatchObject({
      ok: false,
      code: REPORT_CODE.wording,
    });
  });
  it("refuses it in an authenticity signal", () => {
    const signals = { signals: [{ signalId: "PDF-FONT-1", level: "inhabituel", observation: "We reject this file." }] };
    expect(
      checkReportOutput({
        studio: "document-authenticity",
        outputs: [{ key: "signals", value: JSON.stringify(signals) }],
        documentText: "",
        refusedWords: WORDS,
      }),
    ).toMatchObject({ ok: false, code: REPORT_CODE.wording });
  });
  it("matches whole words only, and never the document's own words quoted back", () => {
    const r = recorded(tenant as unknown as Recording, (rep) => {
      rep.findings[0]!.explanation = "Rejected rents are not a topic here; the fraudulent-free text passes.";
    });
    expect(check(r, ["fraud"])).toMatchObject({ ok: true });
  });
  it("refuses a short phrase of the list", () => {
    const r = recorded(tenant as unknown as Recording, (rep) => {
      rep.findings[0]!.explanation = "You should not rent to them.";
    });
    expect(check(r, ["not rent to"])).toMatchObject({ ok: false, code: REPORT_CODE.wording });
  });
});

describe("the order: schema, then citation, then wording", () => {
  it("says the schema first", () => {
    expect(check({ outputs: [], text: "" })).toMatchObject({ code: REPORT_CODE.schema });
  });
});

describe("what an entry of the refused-word list may be", () => {
  it.each([
    ["fraud", "fraud"],
    ["  Mauvais Payeur ", "mauvais payeur"],
  ])("normalises %j to %j", (input, word) => {
    expect(validateRefusedWord(input)).toEqual({ ok: true, word });
  });
  it.each(["", "   ", "a", "one two three four five", "x".repeat(41), "bad\nword", "<b>"])("refuses %j", (input) => {
    expect(validateRefusedWord(input).ok).toBe(false);
  });
});
