"use client";

import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { Textarea } from "@krizaka/ui/field";
import { useState } from "react";

import type { ApplicantFileState } from "@/lib/applicant-page";
import { ANSWER_MAX } from "@/lib/signal-answer-rules";
import { levelTone, ordinaryOf, type TraceSay, whereOf } from "@/lib/signal-cards";

/** What the section reads: the applicant page's `answer` messages, the traces' words and the levels' words. */
export interface SignalAnswerWords {
  answer: Record<
    "title" | "lead" | "label" | "placeholder" | "save" | "remove" | "saved" | "count" | "document",
    string
  >;
  say: TraceSay;
  levels: Record<string, string>;
  /** A date, as the page writes it. */
  day: (iso: string) => string;
}

type Doc = ApplicantFileState["documents"][number];

/**
 * The applicant's answer to the traces found in their documents (ADR-0014 §4, verikora#626): the same facts the owner reads, the
 * ordinary explanations, and one short box per trace. Nothing is asked: an empty box is fine. No score, no verdict, no sort.
 */
export function SignalAnswers({
  documents,
  words,
  busy,
  canAnswer,
  onAnswer,
}: Readonly<{
  documents: readonly Doc[];
  words: SignalAnswerWords;
  busy: boolean;
  canAnswer: boolean;
  onAnswer: (documentId: string, signalId: string, text: string) => void;
}>) {
  const withSignals = documents.filter((d) => d.signals.length > 0);
  if (withSignals.length === 0) {
    return null;
  }
  const a = words.answer;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="traces-title" data-testid="applicant-traces">
      <h2 id="traces-title" className="m-0 font-display text-base font-bold text-fg">
        {a.title}
      </h2>
      <p className="m-0 text-sm text-fg-secondary">{a.lead}</p>
      {withSignals.map((d) => (
        <Card.Root key={d.id} className="flex flex-col gap-3 p-4">
          <h3 className="m-0 text-sm font-semibold text-fg">{a.document.replace("{name}", d.filename)}</h3>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {d.signals.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-1 rounded-lg border border-border-default bg-surface-1 p-3 text-sm"
                data-testid={`trace-${s.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">{s.id}</span>
                  <Badge tone={levelTone(s.level)}>{words.levels[s.level] ?? s.level}</Badge>
                </div>
                <p className="m-0 text-fg">{s.observation}</p>
                {whereOf(words.say, s) ? <p className="m-0 text-xs text-fg-muted">{whereOf(words.say, s)}</p> : null}
                <p className="m-0 text-fg-secondary">{ordinaryOf(words.say, { signalId: s.id, family: s.family })}</p>
                <AnswerBox
                  key={s.answer?.at ?? "none"}
                  signal={s}
                  words={words}
                  busy={busy}
                  canAnswer={canAnswer}
                  onSave={(text) => onAnswer(d.id, s.id, text)}
                />
              </li>
            ))}
          </ul>
        </Card.Root>
      ))}
    </section>
  );
}

function AnswerBox({
  signal,
  words,
  busy,
  canAnswer,
  onSave,
}: Readonly<{
  signal: Doc["signals"][number];
  words: SignalAnswerWords;
  busy: boolean;
  canAnswer: boolean;
  onSave: (text: string) => void;
}>) {
  const a = words.answer;
  const [text, setText] = useState(signal.answer?.text ?? "");
  const changed = text.trim() !== (signal.answer?.text ?? "");
  return (
    <div className="mt-1 flex flex-col gap-2">
      <Textarea
        maxLength={ANSWER_MAX}
        rows={2}
        aria-label={`${a.label} (${signal.id})`}
        placeholder={a.placeholder}
        value={text}
        disabled={!canAnswer || busy}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!canAnswer || busy || !changed} onClick={() => onSave(text)}>
          {text.trim() ? a.save : a.remove}
        </Button>
        <span className="text-xs text-fg-muted">
          {a.count.replace("{n}", String(text.length)).replace("{max}", String(ANSWER_MAX))}
        </span>
        {signal.answer ? (
          <span className="text-xs text-fg-muted">{a.saved.replace("{date}", words.day(signal.answer.at))}</span>
        ) : null}
      </div>
    </div>
  );
}
