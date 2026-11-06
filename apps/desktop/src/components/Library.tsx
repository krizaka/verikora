import { LocalIcon } from "@krizaka/icons";
import { useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { EmptyState } from "@krizaka/ui/empty-state";
import { List } from "@krizaka/ui/list";
import { Switch } from "@krizaka/ui/switch";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { folders, verikoraNative } from "../lib/desktop";
import { inbox } from "../lib/inbox-store";
import { stopAll } from "../lib/subscriptions";
import { refusalText } from "../lib/refusal";
import { type Route } from "../lib/route";
import { sizeOf } from "../lib/size";
import { useBatch } from "../lib/use-batch";
import { Refused, useCheck } from "../lib/use-check";

const FOLDERS_KEY = ["verikora-desktop", "folders"] as const;
const folderKey = (path: string) => ["verikora-desktop", "folder", path] as const;
const lastPart = (path: string) => path.split("/").findLast(Boolean) ?? path;

type Translate = ReturnType<typeof useI18n>["t"];
type Listing = Awaited<ReturnType<typeof verikoraNative.listDocuments>>;

/** Whether the folder on screen is watched, kept in step with the folder shown. */
function useWatched(folder: string | null) {
  const [chosen, choose] = useState<{ folder: string | null; on: boolean } | null>(null);
  // A choice made on one folder never carries to the next: the state is read for the folder shown, else from the store.
  const watched = chosen && chosen.folder === folder ? chosen.on : folder ? inbox.isWatched(folder) : false;
  const setWatched = useCallback((on: boolean) => choose({ folder, on }), [folder]);
  return [watched, setWatched] as const;
}

/** Files dropped on the window from Finder: the native side allowed those files, for this session only. One is a check, several a batch. */
function useWindowDrop(
  checkOne: (path: string) => void,
  checkMany: (input: { name: string; paths: string[] }) => void,
  t: Translate,
  locale: string,
) {
  const [dragging, setDragging] = useState(false);
  const dropDate = useCallback(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    [locale],
  );
  useEffect(() => {
    const stops = [
      folders.onDragging(setDragging),
      folders.onDropped((paths) => {
        setDragging(false);
        if (paths.length === 1 && paths[0]) checkOne(paths[0]);
        else if (paths.length > 1) checkMany({ name: t("batch.nameOfDrop", { date: dropDate() }), paths });
      }),
    ];
    return stopAll(stops);
  }, [checkOne, checkMany, t, dropDate]);
  return dragging;
}

/** The folder on screen is watched by the native side: a change lists it again; in a watched folder, arrivals are checked. */
function useFolderWatch(
  folder: string | null,
  checkMany: (input: { name: string; paths: string[] }) => void,
  t: Translate,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!folder) return;
    void folders.watch(folder).catch(() => undefined);
    const off = folders.onChanged(async (changed) => {
      if (changed !== folder) return;
      await queryClient.invalidateQueries({ queryKey: folderKey(folder) });
      const fresh = inbox.arrivals(folder, (await verikoraNative.listDocuments(folder)).entries);
      if (fresh.length)
        checkMany({ name: t("batch.nameOfFolder", { name: lastPart(folder) }), paths: fresh.map((e) => e.path) });
    });
    return () => {
      void off.then((stop) => stop());
      if (!inbox.isWatched(folder)) void folders.unwatch(folder).catch(() => undefined);
    };
  }, [folder, queryClient, checkMany, t]);
}

function WatchToggle({
  folder,
  entries,
  watched,
  onChange,
}: Readonly<{ folder: string; entries: Listing["entries"]; watched: boolean; onChange: (on: boolean) => void }>) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <Switch
          id="watch-folder"
          checked={watched}
          onCheckedChange={(on: boolean) => {
            inbox.set(folder, on, entries);
            onChange(on);
          }}
        />
        <label htmlFor="watch-folder" className="text-sm font-medium">
          {t("library.watch")}
        </label>
      </div>
      <p className="text-xs text-fg-muted">{t("library.watchHint")}</p>
    </div>
  );
}

function FolderEntries({
  folder,
  listing,
  busy,
  onCheck,
}: Readonly<{
  folder: string;
  listing: { data?: Listing; isPending: boolean };
  busy: boolean;
  onCheck: (path: string) => void;
}>) {
  const { t, locale } = useI18n();
  return (
    <List
      aria-label={folder}
      items={listing.data?.entries ?? []}
      getId={(entry) => entry.path}
      loading={listing.isPending}
      empty={<p className="text-fg-secondary">{t("library.emptyFolder")}</p>}
      row={(entry) =>
        entry.isDir
          ? { title: entry.name, href: `#/library/${encodeURIComponent(entry.path)}`, leading: <LocalIcon size={16} /> }
          : {
              title: entry.name,
              meta: <span>{sizeOf(entry.size, locale)}</span>,
              actions: (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCheck(entry.path)}
                  data-testid="check-document"
                >
                  {t("library.check")}
                </Button>
              ),
            }
      }
    />
  );
}

function refusalOf(error: unknown): Pick<Refused, "reason" | "megabytes"> | null {
  if (error instanceof Refused) return error;
  return error ? { reason: "failed" } : null;
}

function subtitleOf(folder: string | null, dragging: boolean, t: Translate): string {
  if (dragging) return t("library.drop");
  return folder ?? t("library.lead");
}

/**
 * The library: the folders the person granted, a folder's documents, and the window as a drop zone — one document dropped
 * is a check, several are a batch. A watched folder checks what arrives in it.
 */
export function Library({
  folder,
  go,
  onAddFolder,
}: Readonly<{ folder: string | null; go: (route: Route) => void; onAddFolder: () => void }>) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const granted = useQuery({ queryKey: FOLDERS_KEY, queryFn: folders.list });
  const listing = useQuery({
    queryKey: folderKey(folder ?? ""),
    queryFn: () => verikoraNative.listDocuments(folder as string),
    enabled: folder !== null,
  });
  const check = useCheck(go);
  const batch = useBatch(go);
  const [watched, setWatched] = useWatched(folder);

  const revoke = useMutation({
    mutationFn: folders.revoke,
    onSuccess: async (_left, path) => {
      inbox.set(path, false);
      await queryClient.invalidateQueries({ queryKey: FOLDERS_KEY });
      go({ screen: "library", folder: null });
    },
  });

  const { mutate: checkOne } = check;
  const { mutate: checkMany } = batch;
  const dragging = useWindowDrop(checkOne, checkMany, t, locale);
  useFolderWatch(folder, checkMany, t);

  const documents = (listing.data?.entries ?? []).filter((e) => !e.isDir);
  const refusal = refusalOf(check.error ?? batch.error);
  const busy = check.isPending || batch.isPending;
  const isRoot = folder !== null && (granted.data ?? []).includes(folder);

  return (
    <div className={`flex h-full min-h-0 gap-6 ${dragging ? "ym-dropping" : ""}`}>
      <aside aria-label={t("library.folders")} className="flex w-56 shrink-0 flex-col gap-3">
        <Button variant="secondary" onClick={onAddFolder}>
          {t("library.addFolder")}
        </Button>
        <List
          aria-label={t("library.folders")}
          density="compact"
          items={granted.data ?? []}
          getId={(path) => path}
          loading={granted.isPending}
          row={(path) => ({
            title: lastPart(path),
            href: `#/library/${encodeURIComponent(path)}`,
            leading: <LocalIcon size={16} />,
            meta: inbox.isWatched(path) ? <Badge tone="accent">{t("library.watched")}</Badge> : undefined,
          })}
          empty={<p className="text-sm text-fg-secondary">{t("library.emptyFolders")}</p>}
        />
        <Badge tone="accent" className="self-start">
          {t("library.onMac")}
        </Badge>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-xl font-semibold">{folder ? lastPart(folder) : t("library.title")}</h1>
            <p className="text-fg-secondary">{subtitleOf(folder, dragging, t)}</p>
          </div>
          {folder && documents.length > 1 ? (
            <Button
              variant="primary"
              loading={batch.isPending}
              disabled={busy}
              onClick={() =>
                checkMany({
                  name: t("batch.nameOfFolder", { name: lastPart(folder) }),
                  paths: documents.map((d) => d.path),
                })
              }
            >
              {t("library.checkAll")}
            </Button>
          ) : null}
        </header>
        {refusal ? <Alert tone="danger">{refusalText(refusal, t)}</Alert> : null}
        {check.isPending ? <p className="text-fg-secondary">{t("check.preparing")}</p> : null}
        {isRoot ? (
          <WatchToggle folder={folder} entries={listing.data?.entries ?? []} watched={watched} onChange={setWatched} />
        ) : null}
        {folder === null ? (
          <EmptyState
            icon={<LocalIcon size={28} />}
            title={t("library.drop")}
            description={(granted.data ?? []).length ? t("library.dropHint") : t("library.emptyFolders")}
          />
        ) : (
          <FolderEntries folder={folder} listing={listing} busy={busy} onCheck={checkOne} />
        )}
        {isRoot ? (
          <div>
            <Button variant="ghost" size="sm" onClick={() => revoke.mutate(folder)}>
              {t("library.revoke")}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
