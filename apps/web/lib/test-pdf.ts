import type { PageText, TextItem } from "@krizaka/ui/document-viewer";

/** A minimal text PDF for tests: Helvetica, one line per entry, `linesPerPage` lines on each page (A4-ish, 612 × 792). */
export function textPdf(lines: readonly string[], linesPerPage = 40): Uint8Array {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
  const latin1 = (s: string) => Buffer.from(s, "latin1");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects: Buffer[] = [];
  const font = 3 + pages.length * 2;
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push(latin1("<< /Type /Catalog /Pages 2 0 R >>"), latin1(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  pages.forEach((page, i) => {
    const stream = page.map((line, n) => `BT /F1 11 Tf 72 ${720 - n * 16} Td (${esc(line)}) Tj ET`).join("\n");
    objects.push(
      latin1(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`),
      latin1(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`),
    );
  });
  objects.push(latin1("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  let out = latin1("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out = Buffer.concat([out, latin1(`${i + 1} 0 obj\n`), body, latin1("\nendobj\n")]);
  });
  const xref = out.length;
  const entries = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  return new Uint8Array(Buffer.concat([out, latin1(`${table}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)]));
}

/** The text positions of a PDF as the viewer reads them in the browser: the same pdf.js Yomizaka reads text with on the server (unpdf). */
export async function textLayer(pdf: Uint8Array): Promise<PageText[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(pdf.slice());
  const pages: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ page: n, width: vp.width, height: vp.height, items: content.items.filter((i): i is typeof i & TextItem => "str" in i) as TextItem[] });
  }
  return pages;
}
