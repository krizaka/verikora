/** The key as the administration may show it: its prefix and its last four characters, never the rest. Null when none is set. */
export function maskKey(
  key: string | undefined,
): { configured: true; masked: string } | { configured: false; masked: null } {
  if (!key) return { configured: false, masked: null };
  const head = key.slice(0, key.indexOf("_") + 1 || 3);
  return { configured: true, masked: `${head}${"•".repeat(8)}${key.slice(-4)}` };
}
