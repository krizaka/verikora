import { fieldText, refuse } from "../http";
import type { BatchFile } from "./preview";

/** What a batch request carries, read from its multipart form: the CSV's text, the batch's name and the documents it names. */
export interface BatchForm {
  name: string;
  manifest: string;
  files: BatchFile[];
}

const filesOf = async (form: FormData | null, field: string): Promise<BatchFile[]> =>
  Promise.all(
    (form?.getAll(field) ?? [])
      .filter((f): f is File => f instanceof File)
      .map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );

/** `manifest` (the CSV, as a file or text), `name` (or the CSV's file name) and `files`: one reader for the web and the API. */
export async function readBatchForm(req: Request): Promise<BatchForm> {
  const form = await req.formData().catch(() => null);
  const manifest = form?.get("manifest");
  if (!(manifest instanceof File) && typeof manifest !== "string")
    throw refuse(400, "BAD_REQUEST", "A CSV is expected in the field `manifest`");
  const text = typeof manifest === "string" ? manifest : await manifest.text();
  const named = form?.get("name");
  const fromFile = manifest instanceof File ? manifest.name.replace(/\.[^.]+$/, "") : "";
  const name = typeof named === "string" ? named : fromFile;
  return { name, manifest: text, files: await filesOf(form, "files") };
}

const csvCell = (value: string) => (/[",\r\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * One check over the API (verikora#202): `file`, `check` (`compliance`, `audit`… — the batch's names) and an optional
 * `reference`, read as a batch of one row, so a single check and a batch take exactly the same path (store, preflight,
 * reuse, entitlement, flow) and answer the same refusals.
 */
export async function readCheckForm(req: Request): Promise<BatchForm> {
  const form = await req.formData().catch(() => null);
  const [file] = await filesOf(form, "file");
  if (!file) throw refuse(400, "BAD_REQUEST", "A document is expected in the field `file`");
  const check = fieldText(form, "check").trim();
  if (!check) throw refuse(400, "BAD_REQUEST", "The field `check` names the check to run");
  const reference = fieldText(form, "reference").trim();
  const manifest = ["file,check,reference", [file.name, check, reference].map(csvCell).join(",")].join("\n");
  return { name: reference || file.name, manifest, files: [file] };
}
