/*
 * The address's filters, read and written the way `@krizaka/ui/filter-bar` does — as plain functions. That package module is a
 * `"use client"` one, and a server page cannot call a function it exports (React #441 on « Dossiers », verikora#457), so the
 * lists' filters are read and written here, where the server and the browser both reach them. `tests/filter-params` keeps the
 * two identical.
 */

/** The values of each key: repeated or comma-separated (`?state=open,used`), trimmed, empty ones dropped. */
export function readFilterParams(params: URLSearchParams, keys: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      params
        .getAll(key)
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ]),
  );
}

const listOf = (value: string | readonly string[] | null | undefined): string[] => {
  if (value == null) {
    return [];
  }
  return typeof value === "string" ? [value] : [...value];
};

/** `base` with each filter set (a comma-separated list) or deleted when empty; the paging key is reset. */
export function writeFilterParams(
  base: URLSearchParams,
  filters: Record<string, string | readonly string[] | null | undefined>,
  resetKey = "page",
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const [key, value] of Object.entries(filters)) {
    const list = listOf(value);
    if (list.filter(Boolean).length === 0) {
      next.delete(key);
    } else {
      next.set(key, list.filter(Boolean).join(","));
    }
  }
  if (resetKey) {
    next.delete(resetKey);
  }
  return next;
}
