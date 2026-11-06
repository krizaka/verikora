"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { TagChip } from "@krizaka/ui/chip";
import { Dialog } from "@krizaka/ui/dialog";
import { SettingsSection } from "@krizaka/ui/settings-layout";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import type { TagColor } from "@/lib/organisation/rules";
import type { Kind } from "@/lib/workspace/decl";

import { CreateButton, NameDialog } from "./OrganisationActions";

export type Bookmark = { id: string; name: string; color: TagColor };
export type BookmarkGroup = { kind: Kind; bookmarks: readonly Bookmark[] };

/**
 * « Signets » (verikora#339): the person's own coloured categories, one list per kind (files, documents). Create, rename, recolour and
 * delete are the workspace's tag routes (`/api/organize/<kind>/tags`); deleting a bookmark takes it off its files and never touches them.
 */
export function BookmarksSection({ groups }: Readonly<{ groups: readonly BookmarkGroup[] }>) {
  const { say } = useSay();
  return (
    <div className="flex flex-col gap-6" data-testid="bookmarks">
      {groups.map((group) => (
        <SettingsSection
          key={group.kind}
          title={say(`bookmarks.kinds.${group.kind}`)}
          description={say("bookmarks.lead")}
        >
          {group.bookmarks.length === 0 ? (
            <p className="m-0 text-sm text-fg-secondary">{say("bookmarks.none")}</p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {group.bookmarks.map((b) => (
              <BookmarkRow key={b.id} kind={group.kind} bookmark={b} />
            ))}
          </ul>
          <div>
            <CreateButton kind="tag" tagsOf={group.kind} />
          </div>
        </SettingsSection>
      ))}
    </div>
  );
}

function BookmarkRow({ kind, bookmark }: Readonly<{ kind: Kind; bookmark: Bookmark }>) {
  const { say } = useSay();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3">
      <TagChip marker={bookmark.color} size="md">
        {bookmark.name}
      </TagChip>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={say("bookmarks.editNamed", { name: bookmark.name })}
          onClick={() => setDialog("edit")}
        >
          {say("bookmarks.edit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={say("bookmarks.deleteNamed", { name: bookmark.name })}
          onClick={() => setDialog("delete")}
        >
          {say("organisation.delete")}
        </Button>
      </div>
      {dialog === "edit" ? (
        <NameDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={say("bookmarks.edit")}
          initial={bookmark.name}
          color={bookmark.color}
          submit={(name, color) =>
            krizakaFetch(`/api/organize/${kind}/tags/${bookmark.id}`, {
              method: "PATCH",
              json: { name, marker: color ?? bookmark.color },
            })
          }
        />
      ) : null}
      {dialog === "delete" ? <DeleteBookmark kind={kind} bookmark={bookmark} onClose={() => setDialog(null)} /> : null}
    </li>
  );
}

function DeleteBookmark({
  kind,
  bookmark,
  onClose,
}: Readonly<{ kind: Kind; bookmark: Bookmark; onClose: () => void }>) {
  const { say } = useSay();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => krizakaFetch(`/api/organize/${kind}/tags/${bookmark.id}`, { method: "DELETE" }),
  });
  const confirm = async () => {
    setProblem(null);
    try {
      await remove.mutateAsync();
      onClose();
      router.refresh();
    } catch (error) {
      setProblem(say(`errors.${errorKey(error)}`));
    }
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content closeLabel={say("organisation.cancel")}>
        <Dialog.Header>
          <Dialog.Title>{say("organisation.deleteTitle", { name: bookmark.name })}</Dialog.Title>
          <Dialog.Description>{say("bookmarks.deleteKeeps")}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Body className="flex flex-col gap-4">
          {problem ? <Alert tone="danger">{problem}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            <Button size="md" loading={remove.isPending} onClick={() => void confirm()}>
              {say("organisation.delete")}
            </Button>
            <Button variant="secondary" size="md" onClick={onClose}>
              {say("organisation.cancel")}
            </Button>
          </div>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
