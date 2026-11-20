import { readFile } from "node:fs/promises";
import path from "node:path";

/** The mark is the brand export of @krizaka/ui, committed byte for byte (scripts/sync-brand-icons.mjs, hash-locked), never a shape drawn here (#575) and never fetched: a build has no network (#1998). */
export const MARK_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), "lib", "og-logo-dark.svg");

/** The mark as a data address the card can draw; fails the build when the file is missing (a card without its mark is not shipped). */
export async function markDataUri(file: string = MARK_FILE): Promise<string> {
  const bytes = await readFile(file).catch(() => {
    throw new Error(`og.png: the Verikora mark is missing at ${file}`);
  });
  return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
}
