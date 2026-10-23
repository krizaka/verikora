"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Checkbox } from "@krizaka/ui/checkbox";
import { Dropzone, type FileRejection, UploadList, useUploadQueue } from "@krizaka/ui/file-upload";
import { type DocumentKind, type DocumentSummary, MAX_FILE_BYTES, STORAGE_MODE, STORAGE_MODES } from "@yomizaka/core";
import { useRouter } from "next/navigation";
import { type MutableRefObject, type ReactNode, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { useAppConfig } from "@/lib/app-config-client";
import { groupingOffered, optionsShown } from "@/lib/check-flow";
import { useSay } from "@/lib/i18n-client";
import { ROUTE_STATES } from "@/lib/route-state";
import { useRouteState } from "@/lib/use-route-state";

import { ACCEPT, isPhotoFile, type Placement, send, translated } from "./upload";

export type { Placement } from "./upload";

/**
 * The drop zone and its queue (pause, resume, retry), shared by the library, a collection and « Check a document ». A file
 * dropped in a collection or a folder lands there (`placement`); `extra` draws what sits beside the zone (examples).
 */
export function DocumentUploader({ kindRef, placement, onUploaded, extra }: { kindRef?: MutableRefObject<DocumentKind | "auto">; placement?: Placement; onUploaded?: (document: DocumentSummary, requested: DocumentKind | "auto") => void; extra?: (add: (files: File[]) => void) => ReactNode }) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [notices, setNotices] = useState<string[]>([]);
  // The owner's setting (ADR-0007): keeping may be switched off, or ticked by default; the person's own tick wins.
  const prefs = useQuery({ queryKey: ["storage-prefs"], queryFn: () => krizakaFetch("/api/me/storage", { schema: z.object({ settings: z.object({ mode: z.enum(STORAGE_MODES), keepDefault: z.boolean() }) }) }), throwOnError: false, retry: false });
  const app = useAppConfig();
  const keepOff = prefs.data?.settings.mode === STORAGE_MODE.none || app?.features.keepDocuments === false;
  // Not kept unless the owner's setting says so (the document is purged after its check, only the report stays); the choice is `?conserver=`.
  const [choice, setChoice] = useRouteState({ ...ROUTE_STATES.keepDocuments.state, fallback: prefs.data?.settings.keepDefault ? "1" : "0" });
  const keep = !keepOff && choice === "1";
  const keepRef = useRef(keep);
  useEffect(() => {
    keepRef.current = keep;
  }, [keep]);
  const queue = useUploadQueue({
    previews: false,
    retries: 1,
    shouldRetry: (error) => (error as { body?: { code?: string } }).body?.code === "NETWORK",
    upload: async (file, { signal, onProgress }) => {
      // The kind is captured when the file leaves: changing the choice meanwhile never checks this file as another kind.
      const requested = kindRef?.current ?? "auto";
      try {
        const result = await send([file], requested, placement, keepRef.current, signal, onProgress);
        setNotices((n) => [say(result.duplicate ? "library.duplicate" : "library.uploaded", { name: file.name }), ...n].slice(0, 3));
        if (onUploaded) onUploaded(result.document, requested);
        else router.refresh();
      } catch (error) {
        throw translated(error, say);
      }
    },
  });
  // Several photos dropped together are the pages of ONE document (the default; `?pages=0` keeps them apart).
  const [grouping, setGrouping] = useRouteState({ ...ROUTE_STATES.groupPhotos.state });
  const [groupNotice, setGroupNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [grouped, setGrouped] = useState(false);
  // What was dropped, kept apart from the queue: a drop of photos sent as one document never enters the queue.
  const [dropped, setDropped] = useState<{ name: string; type: string }[]>([]);
  const onFiles = (files: File[]) => {
    setDropped((d) => [...d, ...files.map((f) => ({ name: f.name, type: f.type }))]);
    const photos = files.filter(isPhotoFile);
    if (grouping !== "1" || photos.length < 2) return queue.add(files);
    queue.add(files.filter((f) => !isPhotoFile(f)));
    setGrouped(true);
    setGroupNotice(null);
    const requested = kindRef?.current ?? "auto";
    send(photos, requested, placement, keepRef.current, new AbortController().signal, () => undefined)
      .then((result) => {
        setGroupNotice({ tone: "success", text: say("library.groupedUploaded", { count: photos.length }) });
        if (onUploaded) onUploaded(result.document, requested);
        else router.refresh();
      })
      .catch((error: { body?: { code?: string } }) => setGroupNotice({ tone: "danger", text: say(`errors.${error.body?.code ?? "UNKNOWN"}`) }))
      .finally(() => setGrouped(false));
  };
  const refusal = (r: FileRejection) => say(r.reason === "size" ? "library.refusedSize" : r.reason === "type" ? "library.refusedType" : "library.refusedCount", { name: r.file.name });
  // The options are asked once the files are known (the review's B4): keeping, and « these photos are one document » only with two photos or more (C3).
  const known = dropped;
  return (
    <>
      <Dropzone title={say("library.dropTitle")} browseLabel={say("library.browse")} hint={say("library.hint")} accept={ACCEPT} maxSize={app?.maxFileBytes ?? MAX_FILE_BYTES} maxFiles={20} multiple onFiles={onFiles} refusalLabel={refusal} disabled={grouped} />
      {optionsShown(known) || grouped ? (
        <details className="rounded-lg border border-border-default p-3" data-testid="check-options">
          <summary className="cursor-pointer text-sm font-semibold text-fg">{say("library.options")}</summary>
          <div className="mt-3 flex flex-col gap-3">
            {keepOff ? (
              <p className="m-0 text-sm text-fg-secondary" data-testid="keep-disabled">{say("library.keepDisabled")}</p>
            ) : (
            <div className="flex items-start gap-3" data-testid="keep-choice">
              <Checkbox
                id="keep-documents"
                checked={keep}
                onCheckedChange={(v) => setChoice(v === true ? "1" : "0")}
              />
              <label htmlFor="keep-documents" className="flex cursor-pointer flex-col text-sm">
                <span className="font-semibold text-fg">{say("library.keep")}</span>
                <span className="text-fg-secondary">{say(keep ? "library.keepOn" : "library.keepOff")}</span>
              </label>
            </div>
            )}
            {groupingOffered(known) ? (
              <div className="flex items-start gap-3" data-testid="group-photos">
                <Checkbox id="group-photos" checked={grouping === "1"} onCheckedChange={(v) => setGrouping(v === true ? "1" : "0")} />
                <label htmlFor="group-photos" className="flex cursor-pointer flex-col text-sm">
                  <span className="font-semibold text-fg">{say("library.groupPhotos")}</span>
                  <span className="text-fg-secondary">{say(grouping === "1" ? "library.groupPhotosOn" : "library.groupPhotosOff")}</span>
                </label>
              </div>
            ) : null}
            <p className="m-0 text-xs text-fg-secondary">{say("library.photoNotice")}</p>
          </div>
        </details>
      ) : null}
      {groupNotice ? <Alert tone={groupNotice.tone}>{groupNotice.text}</Alert> : null}
      {queue.items.length > 0 ? (
        <UploadList
          items={queue.items}
          locale={locale}
          onPause={queue.pause}
          onResume={queue.resume}
          onCancel={queue.cancel}
          onRemove={queue.remove}
          onRetry={queue.retry}
          labels={{
            list: say("library.dropTitle"),
            pause: (n) => `${say("upload.pause")} ${n}`,
            resume: (n) => `${say("upload.resume")} ${n}`,
            retry: (n) => `${say("upload.retry")} ${n}`,
            cancel: (n) => `${say("upload.cancel")} ${n}`,
            remove: (n) => `${say("upload.remove")} ${n}`,
            status: (st) => say(`upload.${st}`),
          }}
        />
      ) : null}
      {notices.map((n) => (
        <Alert key={n} tone="success">
          {n}
        </Alert>
      ))}
      {extra?.(queue.add)}
    </>
  );
}
