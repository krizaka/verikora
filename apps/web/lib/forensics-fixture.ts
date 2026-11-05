/** Test kit (krizaka-internal#6): a one-page PDF: each entry is a line `[font object, x, y, size, text]`, fonts F1 Helvetica and F2 Courier. */
export function fixture(lines: ReadonlyArray<readonly [string, number, number, number, string]>): Uint8Array {
  const stream = lines.map(([f, x, y, size, t]) => `BT /${f} ${size} Tf ${x} ${y} Td (${t}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const table = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${out.length}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
