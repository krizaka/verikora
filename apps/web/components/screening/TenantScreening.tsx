"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { useState } from "react";

import { INTL } from "@/components/console/format";
import { errorKey } from "@/lib/client";
import type { TenantView } from "@/lib/screening";

import { type ResultWords, ScreeningResultCard } from "./ScreeningResultCard";

export interface TenantWords {
  title: string;
  lead: string;
  whatTitle: string;
  scope: Record<string, string>;
  provider: string;
  why: string;
  notAsked: string;
  whoSees: string;
  retention: string;
  rights: string;
  consent: string;
  decline: string;
  share: string;
  contest: string;
  copy: string;
  comment: string;
  send: string;
  demo: string;
  state: Record<string, string>;
  deleteOn: string;
  contested: string;
  result: ResultWords;
  error: string;
}

/**
 * The applicant's page, reached by the link: who asks, what is checked, why, who sees the result, for how long. They consent
 * or decline; they see the result first; they pass it on or contest it. No account, nothing hidden.
 */
export function TenantScreening({ token, initial, words, locale }: Readonly<{ token: string; initial: TenantView; words: TenantWords; locale: keyof typeof INTL }>) {
  const [view, setView] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [contesting, setContesting] = useState(false);
  const [comment, setComment] = useState("");
  const act = useMutation({
    mutationFn: (body: { action: "consent" | "decline" | "share" | "contest"; comment?: string }) => krizakaFetch("/api/screenings/respond", { method: "POST", json: { token, ...body } }) as Promise<{ screening: TenantView }>,
    onSuccess: (r) => {
      setView(r.screening);
      setContesting(false);
    },
  });
  const run = async (body: { action: "consent" | "decline" | "share" | "contest"; comment?: string }) => {
    setProblem(null);
    try {
      await act.mutateAsync(body);
    } catch (error) {
      setProblem(`${words.error} (${errorKey(error)})`);
    }
  };
  const takeCopy = async () => {
    setProblem(null);
    try {
      const r = (await krizakaFetch("/api/screenings/respond", { method: "POST", json: { token, action: "copy", locale } })) as { copy: { fileName: string; text: string } };
      const url = URL.createObjectURL(new Blob([r.copy.text], { type: "text/plain;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.copy.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(`${words.error} (${errorKey(error)})`);
    }
  };
  const pending = view.status === "requested";
  return (
    <div className="flex max-w-2xl flex-col gap-5" data-testid="tenant-screening">
      <div>
        <h1 className="m-0 font-display text-2xl font-bold text-fg">{words.title}</h1>
        <p className="mt-2 text-fg-secondary">{words.lead.replace("{landlord}", view.landlord)}</p>
      </div>
      <Card.Root className="flex flex-col gap-2 p-4">
        <h2 className="m-0 font-display text-base font-bold text-fg">{words.whatTitle}</h2>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-fg-secondary">
          {view.scope.map((s) => (
            <li key={s}>{words.scope[s]}</li>
          ))}
        </ul>
        <p className="m-0 text-sm text-fg-secondary">{words.provider.replace("{provider}", view.provider)}</p>
        <p className="m-0 text-sm text-fg-secondary">{words.why}</p>
        <p className="m-0 text-sm text-fg-secondary">{words.notAsked}</p>
        <p className="m-0 text-sm text-fg-secondary">{words.whoSees}</p>
        <p className="m-0 text-sm text-fg-secondary">{words.retention.replace("{days}", String(view.retentionDays))}</p>
        <p className="m-0 text-sm text-fg-secondary">{words.rights}</p>
        {view.demo ? <p className="m-0 text-xs font-semibold text-fg-muted">{words.demo}</p> : null}
      </Card.Root>
      <output className="m-0 block text-sm font-semibold text-fg" data-testid="screening-state">
        {words.state[view.status]}
      </output>
      {view.result ? <ScreeningResultCard result={view.result} words={words.result} demo={view.demo ? words.demo : null} /> : null}
      {view.result ? (
        <div>
          <Button size="md" variant="ghost" onClick={() => void takeCopy()} data-testid="copy-result">
            {words.copy}
          </Button>
        </div>
      ) : null}
      {view.resultExpiresAt && view.result ? <p className="m-0 text-xs text-fg-muted">{words.deleteOn.replace("{date}", new Date(view.resultExpiresAt).toLocaleDateString(INTL[locale], { dateStyle: "long" }))}</p> : null}
      {view.contestComment ? <p className="m-0 text-sm text-fg-secondary">{words.contested.replace("{comment}", view.contestComment)}</p> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {pending ? (
        <div className="flex flex-wrap gap-3">
          <Button size="lg" loading={act.isPending} onClick={() => run({ action: "consent" })} data-testid="consent">
            {words.consent}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => run({ action: "decline" })} data-testid="decline">
            {words.decline}
          </Button>
        </div>
      ) : null}
      {view.status === "consented" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Button size="lg" loading={act.isPending} onClick={() => run({ action: "share" })} data-testid="share">
              {words.share}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setContesting(true)} data-testid="contest">
              {words.contest}
            </Button>
          </div>
          {contesting ? (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-fg" htmlFor="contest-comment">
                {words.comment}
              </label>
              <textarea id="contest-comment" className="min-h-24 rounded-lg border border-border-default bg-surface-1 p-3 text-sm text-fg" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button size="md" onClick={() => run({ action: "contest", comment })}>
                {words.send}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
