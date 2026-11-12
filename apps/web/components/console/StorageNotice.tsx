"use client";

import { Button } from "@krizaka/ui/button";
import type { StorageDescriptor } from "@verikora/core";
import { useState } from "react";

import { useSay } from "@/lib/i18n-client";
import { storageNotice } from "@/lib/storage/where";

import { formatDate } from "./format";

/** « Where does this document live? »: where it is kept, until when, and « Delete now » (ADR-0007, #164). */
export function StorageNotice({
  storage,
  retainUntil,
  purged,
  onDelete,
  deleting,
}: Readonly<{
  storage: StorageDescriptor;
  retainUntil: string | null;
  purged: boolean;
  onDelete: () => void;
  deleting: boolean;
}>) {
  const { say, locale } = useSay();
  const [confirming, setConfirming] = useState(false);
  const notice = storageNotice(storage);
  const kept = storage.kind !== "none";
  // Not kept but the file is still there until its check has run: say it, with the deadline.
  const pending = !kept && !purged;
  const keptLine = retainUntil
    ? say("document.where.retentionUntil", { date: formatDate(retainUntil, locale) })
    : say("document.where.retentionNone");
  const retention = kept ? keptLine : say("document.where.retentionNotKept");
  return (
    <section aria-labelledby="where-title" className="flex flex-col gap-2" data-testid="document-storage">
      <h2 id="where-title" className="text-lg font-semibold">
        {say("document.where.title")}
      </h2>
      <p className="m-0 font-semibold" data-testid="document-storage-notice">
        {pending
          ? say("document.where.pendingPurge", { date: retainUntil ? formatDate(retainUntil, locale) : "" })
          : say(`document.where.${notice.key}`, notice.vars)}
      </p>
      <p className="m-0 text-sm text-fg-secondary" hidden={pending}>
        {retention}
      </p>
      {kept || pending ? (
        <div className="flex flex-col items-start gap-2">
          {confirming ? <p className="m-0 text-sm text-fg-secondary">{say("document.where.deleteNowHint")}</p> : null}
          {confirming ? (
            <Button variant="danger" size="sm" className="min-h-11" loading={deleting} onClick={onDelete}>
              {say("document.where.deleteNowConfirm")}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => setConfirming(true)}>
              {say("document.where.deleteNow")}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
