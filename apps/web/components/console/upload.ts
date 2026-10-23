import type { DocumentKind, DocumentSummary } from "@yomizaka/core";

/** What the drop zones offer: PDF, office text and photos. A HEIC is named by extension too (a browser often gives it no type). */
export const ACCEPT = "application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,image/png,image/jpeg,image/heic,image/heif,.pdf,.txt,.docx,.odt,.png,.jpg,.jpeg,.heic,.heif";
/** The same, as the rules `DropOverlay` takes. */
export const ACCEPT_RULES: readonly string[] = ACCEPT.split(",");

export const isPhotoFile = (file: { name: string; type?: string }) => /^image\/(png|jpeg|heic|heif)$/.test(file.type ?? "") || /\.(png|jpe?g|heic|heif)$/i.test(file.name);

/** Where a dropped file lands: a collection, a folder of it, or the default collection (nothing). */
export interface Placement {
  collectionId: string | null;
  folderId: string | null;
}

/** Sends files to the BFF with their progress (XMLHttpRequest: fetch reports no upload progress), aborted on pause. One path for every drop zone of the app. */
export function send(files: File[], kind: DocumentKind | "auto", placement: Placement | undefined, keep: boolean, signal: AbortSignal, onProgress: (sent: number) => void): Promise<{ document: DocumentSummary; duplicate: boolean }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => (xhr.status < 300 ? resolve(xhr.response) : reject(Object.assign(new Error(xhr.response?.code ?? "UNKNOWN"), { body: xhr.response })));
    xhr.onerror = () => reject(Object.assign(new Error("NETWORK"), { body: { code: "NETWORK" } }));
    signal.addEventListener("abort", () => xhr.abort());
    const body = new FormData();
    for (const file of files) body.append("file", file);
    body.append("kind", kind);
    body.append("keep", String(keep));
    if (placement?.collectionId) body.append("collectionId", placement.collectionId);
    if (placement?.folderId) body.append("folderId", placement.folderId);
    xhr.send(body);
  });
}

/** The code the BFF refused with, or UNKNOWN. */
export const refusalCode = (error: unknown): string => (error as { body?: { code?: string } })?.body?.code ?? "UNKNOWN";

/** The refusal in the person's words, its code kept on the error (the queue's retry rule reads it). */
export const translated = (error: unknown, say: (key: string) => string): Error => {
  const code = refusalCode(error);
  return Object.assign(new Error(say(`errors.${code}`)), { body: { code } });
};
