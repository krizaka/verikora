// Builds fixtures/stripe-like-invoice/invoice-synthetic-usd.pdf (krizaka-internal#4028): an invented supplier invoice laid out like
// the ones Stripe renders for a foreign SaaS vendor — USD, card-paid, QST and GST charged, no registration number. Its hyphen and its
// thin spaces are drawn with a glyph (code 0000) the font's ToUnicode map leaves unmapped, which pdf.js reads as U+0000, as in the
// real invoice that Postgres refused.
// Run: node scripts/stripe-like-invoice/build.mjs   (fixed content: the same bytes every time)
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const NUL_GLYPH = "\u0000";
const LINES = [
  `SYNTH${NUL_GLYPH}0001 · $57.49 USD due November 14, 2026`,
  "Invoice",
  `Invoice number SYNTH${NUL_GLYPH}0001`,
  "Date of issue November 14, 2026",
  "Date due November 14, 2026",
  "Synthetic Studio Labs, Inc.",
  "1 Imaginary Way, Fictional City, Delaware 00000, United States",
  "billing@synthetic-studio.example",
  "Bill to",
  "Camille Exemple-Lavoie",
  "1 rue des Fictifs, Montréal Québec H0H 0H0, Canada",
  "Description Qty Unit price Tax Amount",
  "Credits 5,000 $0.01 14.975% $50.00",
  "Subtotal $50.00",
  "Total excluding tax $50.00",
  `QST - Quebec ${NUL_GLYPH}9.975% on $50.00${NUL_GLYPH} $4.99`,
  `GST - Canada ${NUL_GLYPH}5% on $50.00${NUL_GLYPH} $2.50`,
  "Total $57.49",
  "Amount due $57.49 USD",
  "SYNTHETIC - fictional document, no real person or company",
];

// Two-byte codes equal to the Latin-1 code point; code 0000 has no entry.
const toUnicode = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CMapName /Adobe-Identity-UCS def /CMapType 2 def
1 begincodespacerange <0000> <FFFF> endcodespacerange
1 beginbfrange <0020> <00FF> <0020> endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end`;

const hex = (line) => [...line].map((c) => c.codePointAt(0).toString(16).padStart(4, "0")).join("");
const stream = LINES.map((l, n) => `BT /F1 11 Tf 72 ${740 - n * 18} Td <${hex(l)}> Tj ET`).join("\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  "<< /Type /Font /Subtype /Type0 /BaseFont /Helvetica /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 6 0 R >>",
  `<< /Length ${toUnicode.length} >>\nstream\n${toUnicode}\nendstream`,
  "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Helvetica /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 600 >>",
];
let out = "%PDF-1.4\n";
const offsets = objects.map((body, i) => {
  const at = out.length;
  out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = out.length;
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const bytes = Buffer.from(out, "latin1");
const dir = new URL("../../fixtures/stripe-like-invoice/", import.meta.url);
writeFileSync(new URL("invoice-synthetic-usd.pdf", dir), bytes);
const provenance = {
  fictitious: true,
  purpose:
    "A Stripe-style foreign SaaS invoice in USD that charges QST and GST without registration numbers (krizaka-internal#4028).",
  noRealPerson:
    "Supplier, address and bill-to are invented. The real invoice that exposed the fault is never committed.",
  madeBy: "node scripts/stripe-like-invoice/build.mjs",
  file: "invoice-synthetic-usd.pdf",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  facts: {
    subtotal: "50.00",
    qst: "4.99",
    gst: "2.50",
    total: "57.49",
    currency: "USD",
    registrationNumbers: "none printed",
  },
};
writeFileSync(new URL("provenance.json", dir), JSON.stringify(provenance, null, 2) + "\n");
console.log("written", bytes.length, "bytes");
