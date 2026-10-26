import { Badge } from "@krizaka/ui/badge";
import { Card } from "@krizaka/ui/card";

import type { ScreeningResult } from "@/lib/screening";

export interface ResultWords {
  title: string;
  band: Record<string, string>;
  item: Record<string, string>;
  outcome: Record<string, string>;
  note?: string;
  /** Said when some check has not answered: those lines are shown as they stand, never as a result. */
  incompleteNote?: string;
}

/** A minimal screening result: a band and a few items — no score, no account, no address — and the way to read it. */
export function ScreeningResultCard({ result, words, demo }: Readonly<{ result: ScreeningResult; words: ResultWords; demo: string | null }>) {
  return (
    <Card.Root className="flex flex-col gap-3 p-4" data-testid="screening-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-display text-base font-bold text-fg">{words.title}</h3>
        <Badge tone={{ "no-concern": "success", review: "warning", incomplete: "neutral" }[result.band] as "success" | "warning" | "neutral"}>{words.band[result.band]}</Badge>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-secondary">
        {result.items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-2">
            <span>{words.item[i.key]}</span>
            <span className={i.outcome === "clear" || i.outcome === "soon" ? "text-fg" : "font-semibold text-fg"}>{words.outcome[i.outcome]}</span>
          </li>
        ))}
      </ul>
      {words.incompleteNote && result.band === "incomplete" ? <p className="m-0 text-xs text-fg-muted">{words.incompleteNote}</p> : null}
      {words.note && result.band === "review" ? <p className="m-0 text-xs text-fg-muted">{words.note}</p> : null}
      {demo ? <p className="m-0 text-xs font-semibold text-fg-muted">{demo}</p> : null}
    </Card.Root>
  );
}
