"use client";

import { krizakaFetch } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { Checkbox } from "@krizaka/ui/checkbox";
import { ConfirmButton } from "@krizaka/ui/confirm-button";
import { Dropzone, formatBytes, UploadList, useUploadQueue } from "@krizaka/ui/file-upload";
import { MAX_FILE_BYTES } from "@verikora/core";
import { useState } from "react";

import { formatDate } from "@/components/console/format";
import { type ApplicantFileState, applicantPageOf } from "@/lib/applicant-page";
import { errorKey } from "@/lib/client";
import type { Messages } from "@/lib/i18n";
import { sayFrom } from "@/lib/signal-cards";

import { SignalAnswers } from "./SignalAnswers";
import { sendApplicantDocument } from "./upload";

/** The words the page reads: the slices of the dictionary it needs, passed whole by the server page. */
export interface ApplicantFileWords {
  applicant: Messages["applicant"];
  file: Messages["applicantFile"];
  /** The traces' words and the levels' (`console.analysis`), for the section where the applicant answers. */
  traces: Messages["console"]["analysis"]["traces"];
  levels: Messages["console"]["analysis"]["levels"];
  unknown: string;
}

type Consents = readonly ("DOCUMENT_CHECK" | "COURT_RECORDS" | "CREDIT" | "DOCUMENT_KEEP")[];
type Purpose = "DOCUMENT_CHECK" | "DOCUMENT_KEEP";

const say = (table: Record<string, string>, code: string, fallback: string) => table[code] ?? fallback;

/**
 * The applicant's page (verikora#341), reached by the link the manager handed over: the notice, a consent per purpose, the
 * documents asked with what each is for, the upload, « Send my file », the withdrawal and the erasure. No account. Nothing
 * is read before the consent to the check: the drop stays closed until then (the route refuses it too).
 */
export function ApplicantFile({
  token,
  initial,
  consents: initialConsents,
  noticeVersion,
  words,
  locale,
  expires,
}: Readonly<{
  token: string;
  initial: ApplicantFileState;
  consents: Consents;
  noticeVersion: string;
  words: ApplicantFileWords;
  locale: "en" | "fr";
  expires: string;
}>) {
  const [file, setFile] = useState(initial);
  const [consents, setConsents] = useState<Consents>(initialConsents);
  const [erased, setErased] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const page = applicantPageOf(file, consents);
  const errors: Record<string, string> = { ...words.applicant.error, ...words.file.error };
  const fail = (error: unknown) => setProblem(say(errors, errorKey(error), words.unknown));
  const post = async (body: Record<string, unknown>) =>
    krizakaFetch("/api/applicant", { method: "POST", json: { token, ...body } }) as Promise<{
      purposes?: { purpose: Consents[number]; granted: boolean }[];
      file?: ApplicantFileState;
      submitted?: boolean;
      erased?: boolean;
    }>;
  const adopt = (view: Awaited<ReturnType<typeof post>>) => {
    if (view.purposes) {
      setConsents(view.purposes.filter((p) => p.granted).map((p) => p.purpose));
    }
    if (view.file) {
      setFile(view.file);
    }
  };
  const act = async (body: Record<string, unknown>, then?: (view: Awaited<ReturnType<typeof post>>) => void) => {
    setProblem(null);
    setBusy(true);
    try {
      const view = await post(body);
      if (then) {
        then(view);
      } else {
        adopt(view);
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => act({ action: "view" });
  const toggle = (purpose: Purpose, on: boolean) =>
    act(on ? { action: "grant", purpose, noticeVersion } : { action: "withdraw", purpose }, () => refresh());

  if (erased) {
    return (
      <div className="flex max-w-2xl flex-col gap-5" data-testid="applicant-file">
        <h1 className="m-0 font-display text-2xl font-bold text-fg">{words.file.title}</h1>
        <Alert tone="success">{words.applicant.erased}</Alert>
      </div>
    );
  }

  const notice = words.applicant.notice;
  const closed = page.closedBecause;
  return (
    <div className="flex max-w-2xl flex-col gap-5" data-testid="applicant-file">
      <div>
        <h1 className="m-0 font-display text-2xl font-bold text-fg">{words.file.title}</h1>
        <p className="mt-2 text-fg-secondary">{words.file.intro}</p>
        {page.open ? (
          <p className="mt-2 text-sm text-fg-muted">{words.file.expires.replace("{date}", expires)}</p>
        ) : null}
      </div>
      {closed === "LINK_USED" ? <Alert tone="success">{words.file.submitted}</Alert> : null}
      {closed && closed !== "LINK_USED" ? <Alert tone="warning">{say(errors, closed, words.unknown)}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <details className="rounded-lg border border-border-default bg-surface-1 p-4" data-testid="applicant-notice">
        <summary className="cursor-pointer text-sm font-semibold text-fg">{words.file.page.noticeSummary}</summary>
        <div className="mt-3 flex flex-col gap-2 text-sm text-fg-secondary">
          <h2 className="m-0 font-display text-base font-bold text-fg">{notice.title}</h2>
          <p className="m-0 text-xs text-fg-muted">{notice.version.replace("{version}", noticeVersion)}</p>
          <p className="m-0">{notice.intro}</p>
          {(
            [
              [notice.collectedTitle, notice.collected],
              [notice.whyTitle, notice.why],
              [notice.whoTitle, notice.who],
              [notice.howLongTitle, words.file.page.howLong],
              [notice.examinedTitle, notice.examined],
              [notice.askTitle, notice.ask],
            ] as const
          ).map(([title, text]) => (
            <div key={title}>
              <h3 className="m-0 text-sm font-semibold text-fg">{title}</h3>
              <p className="m-0">{text}</p>
            </div>
          ))}
          <p className="m-0">{notice.notAsked}</p>
          <p className="m-0 text-xs">{notice.law}</p>
        </div>
      </details>

      <Card.Root className="flex flex-col gap-3 p-4" data-testid="applicant-consents">
        <h2 className="m-0 font-display text-base font-bold text-fg">{words.file.page.consentTitle}</h2>
        <p className="m-0 text-sm text-fg-secondary">{words.file.page.consentLead}</p>
        {(["DOCUMENT_CHECK", "DOCUMENT_KEEP"] as const).map((purpose) => {
          const on = purpose === "DOCUMENT_CHECK" ? page.consent.check : page.consent.keep;
          const p = words.applicant.purpose[purpose];
          const label =
            purpose === "DOCUMENT_CHECK" ? words.applicant.consent.replace("{version}", noticeVersion) : p.label;
          // A closed link takes no new consent (the route refuses it); an existing one can always be withdrawn.
          const disabled = busy || (on ? !page.canWithdraw : !page.open);
          return (
            <div key={purpose} className="flex items-start gap-3" data-testid={`consent-${purpose}`}>
              <Checkbox
                id={`consent-${purpose}`}
                checked={on}
                disabled={disabled}
                onCheckedChange={(v) => toggle(purpose, v === true)}
              />
              <label htmlFor={`consent-${purpose}`} className="flex cursor-pointer flex-col text-sm">
                <span className="font-semibold text-fg">{label}</span>
                <span className="text-fg-secondary">{p.what}</span>
              </label>
            </div>
          );
        })}
      </Card.Root>

      <section className="flex flex-col gap-3" aria-labelledby="asked-title">
        <h2 id="asked-title" className="m-0 font-display text-base font-bold text-fg">
          {words.file.page.askedTitle}
        </h2>
        {!page.canUpload && page.open ? (
          <p className="m-0 text-sm text-fg-secondary" data-testid="consent-first">
            {words.file.page.consentFirst}
          </p>
        ) : null}
        {page.rows.map((row) => (
          <TypeRow
            key={row.typeId}
            token={token}
            row={row}
            words={words}
            locale={locale}
            canUpload={page.canUpload}
            onSent={refresh}
          />
        ))}
      </section>

      <SignalAnswers
        documents={file.documents}
        busy={busy}
        canAnswer={page.canAnswer}
        onAnswer={(documentId, signalId, text) =>
          act({ action: "answer", documentId, signalId, text }, () => refresh())
        }
        words={{
          answer: words.file.answer,
          say: sayFrom(words.traces),
          levels: words.levels,
          day: (iso) => formatDate(iso, locale),
        }}
      />

      {page.open ? (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            shape="cut"
            disabled={!page.canSubmit || busy}
            loading={busy}
            onClick={() => act({ action: "submit" }, () => refresh())}
            data-testid="submit-file"
          >
            {words.file.submit}
          </Button>
          {!page.canSubmit ? <p className="m-0 text-xs text-fg-muted">{words.file.page.submitHint}</p> : null}
        </div>
      ) : null}

      {page.canWithdraw ? (
        <Card.Root className="flex flex-col gap-2 p-4" data-testid="applicant-erase">
          <p className="m-0 text-sm text-fg-secondary">{words.file.page.eraseLead}</p>
          <div>
            <ConfirmButton
              variant="secondary"
              size="md"
              disabled={busy}
              confirmLabel={words.file.page.eraseConfirm}
              onConfirm={() => act({ action: "erase" }, () => setErased(true))}
            >
              {words.applicant.erase}
            </ConfirmButton>
          </div>
        </Card.Root>
      ) : null}
    </div>
  );
}

/** One document type asked: what it is for, what was received, and its drop (closed until the consent to the check). */
function TypeRow({
  token,
  row,
  words,
  locale,
  canUpload,
  onSent,
}: Readonly<{
  token: string;
  row: { typeId: string; documents: ApplicantFileState["documents"] };
  words: ApplicantFileWords;
  locale: "en" | "fr";
  canUpload: boolean;
  onSent: () => void;
}>) {
  const type = (words.file.types as Record<string, { label: string; what: string } | undefined>)[row.typeId];
  const page = words.file.page;
  const errors: Record<string, string> = { ...words.applicant.error, ...words.file.error };
  const queue = useUploadQueue({
    previews: false,
    retries: 1,
    shouldRetry: (error) => (error as { body?: { code?: string } }).body?.code === "NETWORK",
    upload: async (file, { signal, onProgress }) => {
      try {
        await sendApplicantDocument(token, row.typeId, file, signal, onProgress);
        onSent();
      } catch (error) {
        throw Object.assign(new Error(say(errors, errorKey(error), words.unknown)), {
          body: { code: errorKey(error) },
        });
      }
    },
  });
  const status = {
    queued: page.sending,
    uploading: page.sending,
    paused: page.pause,
    done: page.sent,
    error: page.notSent,
  };
  const pending = queue.items.filter((i) => i.status !== "done");
  return (
    <Card.Root className="flex flex-col gap-3 p-4" data-testid={`asked-${row.typeId}`}>
      <div>
        <h3 className="m-0 font-display text-base font-bold text-fg">{type?.label ?? row.typeId}</h3>
        {type ? <p className="m-0 mt-1 text-sm text-fg-secondary">{type.what}</p> : null}
      </div>
      {row.documents.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label={page.received}>
          {row.documents.map((d) => (
            <li key={d.id} className="flex items-baseline justify-between gap-3 text-fg">
              <span className="min-w-0 truncate">{d.filename}</span>
              <span className="shrink-0 text-xs text-fg-muted">
                {page.received} · {formatBytes(d.sizeBytes, locale)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Dropzone
        title={page.dropTitle}
        browseLabel={page.browse}
        inputLabel={page.inputLabel}
        hint={page.hint}
        accept="application/pdf,.pdf"
        maxSize={MAX_FILE_BYTES}
        multiple={false}
        disabled={!canUpload}
        onFiles={(files) => queue.add(files)}
        refusalLabel={() => errors.FILE_NOT_ACCEPTED ?? words.unknown}
      />
      {pending.length > 0 ? (
        <UploadList
          items={pending}
          locale={locale}
          onPause={queue.pause}
          onResume={queue.resume}
          onCancel={queue.cancel}
          onRemove={queue.remove}
          onRetry={queue.retry}
          labels={{
            list: page.dropTitle,
            pause: (n) => `${page.pause} ${n}`,
            resume: (n) => `${page.resume} ${n}`,
            retry: (n) => `${page.retry} ${n}`,
            cancel: (n) => `${page.cancel} ${n}`,
            remove: (n) => `${page.remove} ${n}`,
            status: (st) => status[st],
          }}
        />
      ) : null}
    </Card.Root>
  );
}
