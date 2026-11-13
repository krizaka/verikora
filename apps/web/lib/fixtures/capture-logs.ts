/**
 * Captures everything the server writes to its log while a test runs — the `console` methods and the raw stdout/stderr
 * streams — so a test can prove what never appears there. No test runner import: it is plain Node.
 */
const target = globalThis.console;
const METHODS = ["log", "info", "warn", "error", "debug"] as const;

export interface LogCapture {
  /** Everything written so far, one line per call. */
  text(): string;
  stop(): void;
}

export function captureLogs(): LogCapture {
  const lines: string[] = [];
  const originals = METHODS.map((m) => [m, target[m]] as const);
  for (const [method] of originals) {
    target[method] = (...args: unknown[]) =>
      void lines.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
  }
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const tap =
    (real: typeof out) =>
    (chunk: unknown, ...rest: never[]) => {
      lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
      return real(chunk as string, ...rest);
    };
  process.stdout.write = tap(out) as typeof process.stdout.write;
  process.stderr.write = tap(err) as typeof process.stderr.write;
  return {
    text: () => lines.join("\n"),
    stop() {
      for (const [method, original] of originals) {
        target[method] = original;
      }
      process.stdout.write = out;
      process.stderr.write = err;
    },
  };
}

function safeJson(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : JSON.stringify(value);
  } catch {
    return String(value);
  }
}
