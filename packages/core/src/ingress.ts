/**
 * DigitalOcean App Platform's ingress replaces any origin 5xx (a 502 included) with its own bare 504 HTML page, and keeps the
 * headers (`x-do-orig-status`). Verikora therefore also sends the refusal's code in `X-Error-Code` (and `Retry-After`): this puts
 * the JSON refusal back, so every client reads the same `{ code }` body as without an ingress (krizaka-internal#3225).
 */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function restoreRefusal(res: Response): Response {
  if (res.ok) return res;
  if (/[/+]json\b/i.test(res.headers.get("content-type") ?? "")) return res;
  const code = res.headers.get("x-error-code");
  if (!code || !CODE.test(code)) return res;
  const original = Number(res.headers.get("x-do-orig-status"));
  const status = Number.isInteger(original) && original >= 400 && original < 600 ? original : res.status;
  const wait = Number(res.headers.get("retry-after"));
  const headers = new Headers(res.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(
    JSON.stringify({
      code,
      error: code,
      ...(res.headers.get("retry-after")?.trim() && Number.isFinite(wait) ? { retryAfterSeconds: wait } : {}),
    }),
    { status, headers },
  );
}
