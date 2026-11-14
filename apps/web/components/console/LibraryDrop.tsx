"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { DropOverlay } from "@krizaka/ui/drop-overlay";
import { Input } from "@krizaka/ui/field";
import { Dropzone, type FileRejection, type UploadItem, useUploadQueue } from "@krizaka/ui/file-upload";
import { QueueStatus, tally, TaskTray, UploadQueue, type UploadQueueItem } from "@krizaka/ui/upload-queue";
import { type Jurisdiction, MAX_FILE_BYTES, STORAGE_MODE, STORAGE_MODES } from "@verikora/core";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { z } from "zod";

import { useAppConfig } from "@/lib/app-config-client";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { startIfSure } from "./start-check";
import { ACCEPT, ACCEPT_RULES, isPhotoFile, type Placement, refusalCode, send, translated } from "./upload";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The queue's states in the tray's vocabulary: sending is « reading » (the server reads the file as it lands), a pause waits like a queued file. */
const STATUS: Record<UploadItem["status"], QueueStatus> = {
  queued: QueueStatus.Queued,
  uploading: QueueStatus.Reading,
  paused: QueueStatus.Queued,
  done: QueueStatus.Done,
  error: QueueStatus.Failed,
};
const REFUSAL: Partial<Record<string, string>> = {
  size: "library.refusedSize",
  type: "library.refusedType",
  count: "library.refusedCount",
};

/** Several photos dropped together are the pages of ONE document (the default, as on the task page): the first photo carries the group, the other files go one by one. */
export function bundlePhotos(files: readonly File[]): { queued: File[]; groups: Map<File, File[]> } {
  const photos = files.filter(isPhotoFile);
  if (photos.length < 2) return { queued: [...files], groups: new Map() };
  return { queued: [...files.filter((f) => !isPhotoFile(f)), photos[0]!], groups: new Map([[photos[0]!, photos]]) };
}

/** The photo groups by their lead file, read by the upload that carries them (the File is the key: nothing to clean up). */
const GROUPS = new WeakMap<File, File[]>();

/** The tray's rows from the queue: the file (a photo group says how many it carries), where it stands in words, its progress while it sends, a retry once it failed. */
export function queueItemsOf(
  items: readonly UploadItem[],
  say: Say,
  retry?: (id: string) => void,
  pages?: ReadonlyMap<string, number>,
): UploadQueueItem[] {
  return items.map((i) => {
    const status = STATUS[i.status];
    const count = pages?.get(i.name) ?? 1;
    return {
      id: i.id,
      name: count > 1 ? say("library.tray.photos", { name: i.name, count: count - 1 }) : i.name,
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
export function UploadTray({ items }: Readonly<{ items: readonly UploadQueueItem[] }>) {
  const { say } = useSay();
  if (!items.length) return null;
  const t = tally(items);
  const working = t.working + t.queued;
  const summary = [
    say(pluralKey("library.tray.working", working), { count: working }),
    say(pluralKey("library.tray.done", t.done), { count: t.done }),
    ...(t.failed ? [say(pluralKey("library.tray.failed", t.failed), { count: t.failed })] : []),
  ].join(" · ");
  return (
    <TaskTray
      title={say("library.tray.title")}
      summary={summary}
      toggleLabel={say("library.tray.collapse")}
      openLabel={say("library.tray.show")}
      data-testid="upload-tray"
    >
      <UploadQueue label={say("library.tray.title")} items={items} />
    </TaskTray>
  );
}

/** What the drop island offers the page it wraps: adding files (a picker button in a header), and its zone where the page wants it. */
const DropIsland = createContext<{ add: (files: File[]) => void; zone: ReactNode } | null>(null);

/** « Ajouter des documents »: a picker button that feeds the drop island it sits in (the header's action of a place); nothing outside one. */
export function AddFilesButton({
  children,
  variant = "secondary",
  size = "md",
}: Readonly<{ children: ReactNode; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" }>) {
  const island = useContext(DropIsland);
  const input = useRef<HTMLInputElement>(null);
  if (!island) return null;
  return (
    <>
      <Button variant={variant} size={size} onClick={() => input.current?.click()} data-testid="add-files">
        {children}
      </Button>
      <Input
        ref={input}
        className="hidden"
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          if (files.length) island.add(files);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** The island's drop zone, where the page wants it (an empty place); nothing outside an island. */
export function DropZone() {
  return useContext(DropIsland)?.zone ?? null;
}

/**
 * Drop anywhere on the library (the review's B4) — or on a place, filing into it (Y7): a full-window overlay takes a file dragged over the page, an optional zone
 * (the empty library's only one) takes a click, and the tray follows the queue while the person keeps browsing. One path
 * (`send`) with the kind left to Verikora and the owner's keeping preference; the lists refresh as each file lands.
 */
export function LibraryDrop({
  zone = false,
  examples,
  jurisdictions = ["QC"],
  placement,
  children,
}: Readonly<{
  zone?: boolean;
  examples?: (add: (files: File[]) => void) => ReactNode;
  jurisdictions?: readonly Jurisdiction[];
  placement?: Placement;
  children?: ReactNode;
}>) {
  const { say } = useSay();
  const router = useRouter();
  const app = useAppConfig();
  const [notice, setNotice] = useState<string | null>(null);
  // How many photos each group carries, by its lead file's name: the tray says it.
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const prefs = useQuery({
    queryKey: ["storage-prefs"],
    queryFn: () =>
      krizakaFetch("/api/me/storage", {
        schema: z.object({ settings: z.object({ mode: z.enum(STORAGE_MODES), keepDefault: z.boolean() }) }),
      }),
    throwOnError: false,
    retry: false,
  });
  const keep =
    prefs.data?.settings.mode !== STORAGE_MODE.none &&
    app?.features.keepDocuments !== false &&
    Boolean(prefs.data?.settings.keepDefault);
  const queue = useUploadQueue({
    previews: false,
    retries: 1,
    shouldRetry: (error) => refusalCode(error) === "NETWORK",
    upload: async (file, { signal, onProgress }) => {
      let stored;
      try {
        stored = await send(GROUPS.get(file) ?? [file], "auto", placement, keep, signal, onProgress);
      } catch (error) {
        throw translated(error, say);
      }
      // A file dropped on the library is checked like one dropped on the task page: at once when its kind is sure (the review's Y4).
      if (!stored.duplicate) await startIfSure(stored.document.id, "auto", jurisdictions, new Date());
      router.refresh();
    },
  });
  const refusal = (r: FileRejection) => say(REFUSAL[r.reason] ?? "library.refusedCount", { name: r.file.name });
  const add = (files: readonly File[]) => {
    const { queued, groups } = bundlePhotos(files);
    for (const [lead, group] of groups) GROUPS.set(lead, group);
    if (groups.size)
      setPages((m) => new Map([...m, ...[...groups].map(([lead, group]) => [lead.name, group.length] as const)]));
    queue.add(queued);
  };
  const items = queueItemsOf(queue.items, say, queue.retry, pages);
  const zoneNode = (
    <div data-testid="library-dropzone">
      <Dropzone
        title={say("library.dropTitle")}
        browseLabel={say("library.browse")}
        inputLabel={say("library.inputLabel")}
        hint={say("library.hint")}
        accept={ACCEPT}
        maxSize={app?.maxFileBytes ?? MAX_FILE_BYTES}
        maxFiles={20}
        multiple
        onFiles={(files) => add(files)}
        refusalLabel={refusal}
      />
    </div>
  );
  return (
    <>
      <DropOverlay
        label={say("library.dropAnywhere")}
        hint={say("library.dropAnywhereHint")}
        accept={ACCEPT_RULES}
        onFiles={(accepted, rejected) => {
          if (accepted.length) add(accepted);
          setNotice(rejected.length ? say("library.refusedType", { name: rejected[0]!.name }) : null);
        }}
      />
      {zone ? zoneNode : null}
      {examples?.(add)}
      {notice ? <Alert tone="warning">{notice}</Alert> : null}
      {children !== undefined ? (
        <DropIsland.Provider value={{ add, zone: zoneNode }}>{children}</DropIsland.Provider>
      ) : null}
      <UploadTray items={items} />
    </>
  );
}
