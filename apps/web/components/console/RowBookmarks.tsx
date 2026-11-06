"use client";

import { BookmarkIcon } from "@krizaka/icons";
import { krizakaFetch, useMutation } from "@krizaka/query";
import { Button } from "@krizaka/ui/button";
import { DropdownMenu } from "@krizaka/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { withBookmark } from "@/lib/organisation/bookmarks";
import type { Tag } from "@/lib/organisation/store";

import { TagChips } from "./TagChips";

/**
 * One tap to bookmark a document from its row (verikora#339): a menu of the person's bookmarks, each a toggle that applies or lifts it on
 * this document alone (`/api/organize/document/tags/apply`, one audit line). The row's chips follow at once; the page refreshes behind.
 */
export function RowBookmarks({
  id,
  name,
  bookmarks,
  worn,
}: Readonly<{ id: string; name: string; bookmarks: readonly Tag[]; worn: readonly string[] }>) {
  const { say } = useSay();
  const router = useRouter();
  const [mine, setMine] = useState<readonly string[]>(worn);
  const [problem, setProblem] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (json: { ids: string[]; add?: string[]; remove?: string[] }) =>
      krizakaFetch("/api/organize/document/tags/apply", { method: "POST", json }),
  });
  const toggle = async (tagId: string, on: boolean) => {
    const before = mine;
    setProblem(null);
    setMine(withBookmark(before, tagId, on));
    try {
      await apply.mutateAsync(on ? { ids: [id], add: [tagId] } : { ids: [id], remove: [tagId] });
      router.refresh();
    } catch (error) {
      setMine(before);
      setProblem(say(`errors.${errorKey(error)}`));
    }
  };
  return (
    <span className="flex items-center justify-end gap-2" data-testid="row-bookmarks">
      <TagChips tags={bookmarks.filter((b) => mine.includes(b.id))} />
      {problem ? (
        <span role="alert" className="text-xs text-fg-danger">
          {problem}
        </span>
      ) : null}
      {bookmarks.length > 0 ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="sm" aria-label={say("documentsPage.bookmarkNamed", { name })}>
              <BookmarkIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {bookmarks.map((b) => (
              <DropdownMenu.CheckboxItem
                key={b.id}
                checked={mine.includes(b.id)}
                onCheckedChange={(on: boolean) => void toggle(b.id, on)}
              >
                <TagChips tags={[b]} />
              </DropdownMenu.CheckboxItem>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      ) : null}
    </span>
  );
}
