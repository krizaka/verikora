/**
 * A cell of a CSV we hand out (verikora#242, review): quoted when it holds a separator, a quote or a line break, and made inert when a
 * spreadsheet would run it as a formula — a file name or a reference that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets
 * an apostrophe in front (the manifest parser keeps what the customer wrote, so `=1+1` can reach an export). Numbers are left alone.
 */
export function csvCell(value: string | number | null): string {
  if (typeof value === "number") return String(value);
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
