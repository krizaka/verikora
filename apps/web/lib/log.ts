import { describeError, redactSecrets } from "./redact";

/** The server's logs. Every line goes through `redactSecrets`; an error is described, never printed as an object (verikora#386). */
export function logInfo(message: string): void {
  console.log(redactSecrets(message));
}

export function logWarn(message: string): void {
  console.warn(redactSecrets(message));
}

export function logError(message: string, error?: unknown): void {
  console.error(error === undefined ? redactSecrets(message) : `${redactSecrets(message)} ${describeError(error)}`);
}
