"use client";

import { CopyIcon } from "@krizaka/icons";
import { IconButton } from "@krizaka/ui/button";
import { useState } from "react";

import { useSay } from "@/lib/i18n-client";

// @fixed: the characters of a run id shown before the ellipsis; the full id is the title and what « copy » puts on the clipboard.
const SHOWN = 8;

/** A run id in a table: mono, one line, cut with an ellipsis in a column of fixed minimum width, and a copy action (verikora#457: it wrapped a character per line). */
export function RunId({ id }: Readonly<{ id: string | null | undefined }>) {
  const { say } = useSay();
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-fg-muted">—</span>;
  const copy = () => void navigator.clipboard?.writeText(id).then(() => setCopied(true));
  return (
    <span className="inline-flex min-w-[9.5rem] items-center gap-1" data-testid="run-id">
      <code className="min-w-0 truncate font-mono text-xs tabular-nums text-fg-muted" title={id}>
        {id.length > SHOWN ? `${id.slice(0, SHOWN)}…` : id}
      </code>
      <IconButton
        label={copied ? say("checks.runCopied") : say("checks.runCopy", { id: id.slice(0, SHOWN) })}
        variant="ghost"
        size="icon"
        onClick={copy}
      >
        <CopyIcon aria-hidden="true" />
      </IconButton>
    </span>
  );
}
