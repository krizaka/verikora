"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@krizaka/ui/command";
import { queryKeys, searchHit } from "@verikora/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { useSay } from "@/lib/i18n-client";

/** The least a search is asked for: the server answers nothing under it (lib/search.ts). */
// @fixed: the same floor as the server's, so the palette never asks for what is certain to be empty.
const LEAST_LETTERS = 2;

/**
 * The palette of the top bar's search (B2, P14 — the design's « Recherche leaves the rail for ⌘K »): the frame (`AppFrame`) draws the field
 * and the ⌘K / Ctrl K shortcut, the shell holds `open`. It asks `/api/search` as the person types (the same hits as the search page, the passages
 * escaped by the server), a hit opens its document, and « Tous les résultats » leads to the page with the query in its address.
 */
export function ConsoleSearch({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [q, setQ] = useState("");
  const words = q.trim();
  const ready = words.length >= LEAST_LETTERS;
  const hits = useQuery({
    queryKey: queryKeys.search(words),
    queryFn: () =>
      krizakaFetch("/api/search", {
        query: { q: words },
        schema: z.object({ hits: z.array(searchHit) }),
      }).then((r) => r.hits),
    enabled: open && ready,
  });
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) setQ("");
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      label={say("shell.palette.label")}
      shouldFilter={false}
      footer={
        ready ? (
          <Link
            href={`/${locale}/app/search?q=${encodeURIComponent(words)}`}
            onClick={() => close(false)}
            className="text-sm font-semibold text-fg-accent hover:underline"
          >
            {say("shell.palette.all")}
          </Link>
        ) : undefined
      }
    >
      <CommandInput placeholder={say("shell.palette.placeholder")} value={q} onValueChange={setQ} />
      <CommandList
        label={say("shell.palette.hits")}
        emptyLabel={ready ? say("shell.palette.none", { q: words }) : say("shell.palette.type")}
      >
        {ready && hits.isPending ? <CommandLoading>{say("shell.palette.hits")}</CommandLoading> : null}
        {ready && !hits.isPending && hits.data?.length ? (
          <CommandGroup heading={say("shell.palette.hits")}>
            {hits.data.map((hit, i) => (
              <CommandItem
                key={`${hit.documentId}-${hit.source}-${i}`}
                value={`${hit.documentId}-${hit.source}-${i}`}
                onSelect={() => {
                  close(false);
                  router.push(`/${locale}/app/documents/${hit.documentId}`);
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-fg">{hit.title}</span>
                  {/* The server escapes the passage and adds only <b> around the words found (lib/search.ts). */}
                  <span
                    className="truncate text-xs text-fg-secondary [&_b]:font-semibold [&_b]:text-fg"
                    dangerouslySetInnerHTML={{ __html: hit.passage }}
                  />
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
