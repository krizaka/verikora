import type { Anomaly } from "./forensics";
import type { TextRun } from "./forensics-text";

/**
 * Document forensics, content consistency (ADR-0014, krizaka-restricted#12): the arithmetic of a pay stub's own figures. Pure, no
 * model, no engine call. Read from the text runs of the text layer; a field that is not found, or found twice, means the case does
 * not run: nothing is guessed. `inconsistent` is only for arithmetic on the document's own figures (CONTENT-PAY-001, -002); the
 * deduction rates against the year's tables are another slice, because they need dated data with an official source.
 */

/** Cents, from a printed amount (« 2 400,00 », « 2,400.00 », « 1887.60 $ »). Null unless the last separator is followed by exactly two digits. */
export function parseAmount(text: string): number | null {
  const clean = text
    .replace(/[\s $€]/g, "")
    .replace(/CAD/i, "")
    .trim();
  const m = /^(-?)((?:\d{1,3}(?:[,.]\d{3})*|\d+))[,.](\d{2})$/.exec(clean);
  if (!m) return null;
  const whole = (m[2] ?? "").replace(/[,.]/g, "");
  const cents = Number(whole) * 100 + Number(m[3]);
  return m[1] ? -cents : cents;
}

// @fixed: a printed stub rounds each line to the cent, so the sum may be one cent off the printed total.
const ROUNDING_CENTS = 1;
// @fixed: runs of one printed row share a baseline within a point or two.
const SAME_ROW = 2;

const FIELD_LABELS = {
  gross: /\b(salaire brut|gross (pay|earnings|salary)|total gains)\b/,
  deductions: /\b(total (des )?(retenues|deductions)|retenues totales|total deductions)\b/,
  net: /\b(salaire net|paie nette|net pay|net salary|montant net)\b/,
} as const;
type Field = keyof typeof FIELD_LABELS;

interface Amount {
  cents: number;
  run: TextRun;
}
interface Row {
  page: number;
  label: string;
  amounts: Amount[];
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function rowsOf(runs: readonly TextRun[]): Row[] {
  const rows: { page: number; y: number; runs: TextRun[] }[] = [];
  for (const r of runs) {
    const row = rows.find((x) => x.page === r.page && Math.abs(x.y - r.y) <= SAME_ROW);
    if (row) row.runs.push(r);
    else rows.push({ page: r.page, y: r.y, runs: [r] });
  }
  return rows.map(({ page, runs: rs }) => {
    const sorted = [...rs].sort((a, b) => a.x - b.x);
    const amounts = sorted.flatMap((run) => {
      const cents = parseAmount(run.text);
      return cents === null ? [] : [{ cents, run }];
    });
    const label = plain(
      sorted
        .filter((r) => parseAmount(r.text) === null)
        .map((r) => r.text)
        .join(" "),
    );
    return { page, label, amounts };
  });
}

/** The one row that carries a field's label, with at least one amount; null when absent or printed more than once. */
function rowOf(rows: readonly Row[], field: Field): Row | null {
  const found = rows.filter((r) => FIELD_LABELS[field].test(r.label) && r.amounts.length > 0);
  return found.length === 1 ? (found[0] ?? null) : null;
}

const boxOf = (amounts: readonly Amount[]) => {
  const x = Math.min(...amounts.map((a) => a.run.x));
  const y = Math.min(...amounts.map((a) => a.run.y));
  return {
    x,
    y,
    width: Math.max(...amounts.map((a) => a.run.x + a.run.width)) - x,
    height: Math.max(...amounts.map((a) => a.run.y + a.run.height)) - y,
  };
};

const fmt = (cents: number) => (cents / 100).toFixed(2);

export function analysePayStub(runs: readonly TextRun[]): Anomaly[] {
  const rows = rowsOf(runs);
  const gross = rowOf(rows, "gross");
  const deductions = rowOf(rows, "deductions");
  const net = rowOf(rows, "net");
  const found: Anomaly[] = [];

  const g = gross?.amounts[0];
  const d = deductions?.amounts[0];
  const n = net?.amounts[0];
  if (g && d && n && Math.abs(g.cents - d.cents - n.cents) > ROUNDING_CENTS) {
    found.push({
      kind: "payroll-sum",
      level: "inconsistent",
      page: g.run.page,
      bbox: boxOf([g, d, n]),
      evidence: `CONTENT-PAY-001: gross ${fmt(g.cents)} minus deductions ${fmt(d.cents)} is ${fmt(g.cents - d.cents)}, the stub prints a net of ${fmt(n.cents)}.`,
    });
  }

  const ytd = gross?.amounts[1];
  if (g && ytd && ytd.cents < g.cents) {
    found.push({
      kind: "payroll-ytd",
      level: "inconsistent",
      page: ytd.run.page,
      bbox: boxOf([g, ytd]),
      evidence: `CONTENT-PAY-002: the gross year to date ${fmt(ytd.cents)} is below the period's gross ${fmt(g.cents)} it should contain.`,
    });
  }
  return found;
}
