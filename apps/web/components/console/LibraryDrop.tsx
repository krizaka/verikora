"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { DropOverlay } from "@krizaka/ui/drop-overlay";
import { Dropzone, type FileRejection, type UploadItem, useUploadQueue } from "@krizaka/ui/file-upload";
import { QueueStatus, tally, TaskTray, UploadQueue, type UploadQueueItem } from "@krizaka/ui/upload-queue";
import { type Jurisdiction, MAX_FILE_BYTES, STORAGE_MODE, STORAGE_MODES } from "@yomizaka/core";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { z } from "zod";

import { useAppConfig } from "@/lib/app-config-client";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { startIfSure } from "./start-check";
import { ACCEPT, ACCEPT_RULES, refusalCode, send, translated } from "./upload";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The queue's states in the tray's vocabulary: sending is « reading » (the server reads the file as it lands), a pause waits like a queued file. */
const STATUS: Record<UploadItem["status"], QueueStatus> = { queued: QueueStatus.Queued, uploading: QueueStatus.Reading, paused: QueueStatus.Queued, done: QueueStatus.Done, error: QueueStatus.Failed };
const REFUSAL: Partial<Record<string, string>> = { size: "library.refusedSize", type: "library.refusedType", count: "library.refusedCount" };

/** The tray's rows from the queue: the file, where it stands in words, its progress while it sends, a retry once it failed. */
export function queueItemsOf(items: readonly UploadItem[], say: Say, retry?: (id: string) => void): UploadQueueItem[] {
  return items.map((i) => {
    const status = STATUS[i.status];
    return {
      id: i.id,
      name: i.name,
      status,
      statusText: status === QueueStatus.Failed && i.error ? i.error : say(`upload.${i.status}`),
      progress: status === QueueStatus.Reading ? i.progress : undefined,
      trailing:
        status === QueueStatus.Failed && retry ? (
          <Button size="sm" variant="ghost" onClick={() => retry(i.id)}>
            {say("upload.retry")}
          </Button>
        ) : undefined,
    };
  });
}

/** The non-blocking tray of the files being checked (bottom-right from `sm`, the bottom edge on a phone); nothing while the queue is empty. */
export function UploadTray({ items }: { items: readonly UploadQueueItem[] }) {
  const { say } = useSay();
  if (!items.length) return null;
  const t = tally(items);
  const working = t.working + t.queued;
  const summary = [say(pluralKey("library.tray.working", working), { count: working }), say(pluralKey("library.tray.done", t.done), { count: t.done }), ...(t.failed ? [say(pluralKey("library.tray.failed", t.failed), { count: t.failed })] : [])].join(" · ");
  return (
    <TaskTray title={say("library.tray.title")} summary={summary} toggleLabel={say("library.tray.collapse")} openLabel={say("library.tray.show")} data-testid="upload-tray">
      <UploadQueue label={say("library.tray.title")} items={items} />
    </TaskTray>
  );
}

/**
 * Drop anywhere on the library (the review's B4): a full-window overlay takes a file dragged over the page, an optional zone
 * (the empty library's only one) takes a click, and the tray follows the queue while the person keeps browsing. One path
 * (`send`) with the kind left to Yomizaka and the owner's keeping preference; the lists refresh as each file lands.
 */
export function LibraryDrop({ zone = false, examples, jurisdictions = ["QC"] }: { zone?: boolean; examples?: (add: (files: File[]) => void) => ReactNode; jurisdictions?: readonly Jurisdiction[] }) {
  const { say } = useSay();
  const router = useRouter();
  const app = useAppConfig();
  const [notice, setNotice] = useState<string | null>(null);
  const prefs = useQuery({ queryKey: ["storage-prefs"], queryFn: () => krizakaFetch("/api/me/storage", { schema: z.object({ settings: z.object({ mode: z.enum(STORAGE_MODES), keepDefault: z.boolean() }) }) }), throwOnError: false, retry: false });
  const keep = prefs.data?.settings.mode !== STORAGE_MODE.none && app?.features.keepDocuments !== false && Boolean(prefs.data?.settings.keepDefault);
  const queue = useUploadQueue({
    previews: false,
    retries: 1,
    shouldRetry: (error) => refusalCode(error) === "NETWORK",
    upload: async (file, { signal, onProgress }) => {
      let stored;
      try {
        stored = await send([file], "auto", undefined, keep, signal, onProgress);
      } catch (error) {
        throw translated(error, say);
      }
      // A file dropped on the library is checked like one dropped on the task page: at once when its kind is sure (the review's Y4).
      if (!stored.duplicate) await startIfSure(stored.document.id, "auto", jurisdictions);
      router.refresh();
    },
  });
  const refusal = (r: FileRejection) => say(REFUSAL[r.reason] ?? "library.refusedCount", { name: r.file.name });
  const items = queueItemsOf(queue.items, say, queue.retry);
  return (
    <>
      <DropOverlay
        label={say("library.dropAnywhere")}
        hint={say("library.dropAnywhereHint")}
        accept={ACCEPT_RULES}
        onFiles={(accepted, rejected) => {
          if (accepted.length) queue.add(accepted);
          setNotice(rejected.length ? say("library.refusedType", { name: rejected[0]!.name }) : null);
        }}
      />
      {zone ? (
        <div data-testid="library-dropzone">
          <Dropzone title={say("library.dropTitle")} browseLabel={say("library.browse")} hint={say("library.hint")} accept={ACCEPT} maxSize={app?.maxFileBytes ?? MAX_FILE_BYTES} maxFiles={20} multiple onFiles={(files) => queue.add(files)} refusalLabel={refusal} />
        </div>
      ) : null}
      {examples?.(queue.add)}
      {notice ? <Alert tone="warning">{notice}</Alert> : null}
      <UploadTray items={items} />
    </>
  );
}
