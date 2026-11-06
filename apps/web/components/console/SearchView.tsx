"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Badge } from "@krizaka/ui/badge";
import { EmptyState } from "@krizaka/ui/empty-state";
import { Mascot } from "@krizaka/ui/mascots";
import { PageHeader } from "@krizaka/ui/page-header";
import { SearchField } from "@krizaka/ui/search-field";
import { Skeleton } from "@krizaka/ui/skeleton";
import { queryKeys, searchHit } from "@verikora/core";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

type SearchHit = z.infer<typeof searchHit>;

/** The hits — the count with proper plurals (H1), the words found in bold (the server escapes the passage and adds only `<b>`) — or the owl when nothing matches. */
export function SearchResults({ hits, q }: Readonly<{ hits: SearchHit[]; q: string }>) {
  const { say, locale } = useSay();
  if (!hits.length)
    return (
      <EmptyState
        icon={<Mascot bird="owl" mood="thinking" size={72} />}
        title={say("search.none", { q })}
        description={say("search.hint")}
        data-testid="search-none"
      />
    );
  return (
    <>
      <p className="text-sm text-fg-secondary" aria-live="polite" data-testid="search-count">
        {say(pluralKey("search.results", hits.length), { count: hits.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {hits.map((hit, i) => (
          <li key={`${hit.documentId}-${hit.source}-${i}`}>
            <Link
              href={`/${locale}/app/documents/${hit.documentId}`}
              className="block rounded-lg border border-border-default bg-surface-1 p-3 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-fg">{hit.title}</span>
                <span className="flex gap-1">
                  <Badge tone="neutral">{say(`kinds.${hit.kind}`)}</Badge>
                  <Badge tone={hit.source === "finding" ? "accent" : "neutral"}>
                    {say(`search.sources.${hit.source}`)}
                  </Badge>
                </span>
              </span>
              {/* The server escapes the passage and adds only <b> around the words found (lib/search.ts). */}
              <span
                className="mt-1 block text-sm text-fg-secondary [&_b]:font-semibold [&_b]:text-fg"
                dangerouslySetInnerHTML={{ __html: hit.passage }}
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Search across the documents and Sovkora's findings; the query lives in the address. */
export function SearchView({ initialQuery }: Readonly<{ initialQuery: string }>) {
  const { say } = useSay();
  const router = useRouter();
  const path = usePathname() ?? "";
  const [q, setQ] = useState(initialQuery);
  const words = q.trim();
  const hits = useQuery({
    queryKey: queryKeys.search(words),
    queryFn: () =>
      krizakaFetch("/api/search", { query: { q: words }, schema: z.object({ hits: z.array(searchHit) }) }).then(
        (r) => r.hits,
      ),
    enabled: words.length >= 2,
  });
  const onSearch = (value: string) => {
    setQ(value);
    router.replace(value.trim() ? `${path}?q=${encodeURIComponent(value.trim())}` : path, { scroll: false });
  };
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title={say("shell.titles.search")} description={say("search.lead")} />
      <SearchField
        label={say("search.label")}
        placeholder={say("search.placeholder")}
        defaultValue={initialQuery}
        onSearch={onSearch}
        debounce={250}
      />
      <p className="text-xs text-fg-muted">{say("search.hint")}</p>
      {hits.isFetching && !hits.data ? <Skeleton className="h-24 w-full" /> : null}
      {hits.data ? <SearchResults hits={hits.data} q={words} /> : null}
    </div>
  );
}
