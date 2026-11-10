"use client";

import { krizakaFetch, useQuery } from "@krizaka/query";
import { Button } from "@krizaka/ui/button";
import { Dialog } from "@krizaka/ui/dialog";
import { queryKeys } from "@verikora/core";
import { useState } from "react";
import { z } from "zod";

import { useSay } from "@/lib/i18n-client";

import { ReportShare } from "./ReportShare";

const sharingStatus = z.object({
  grants: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["member", "invited", "expired", "revoked"]),
    }),
  ),
  requests: z.array(z.object({ id: z.string() })),
});

/**
 * The primary action of the report header (verikora#2293): a button that opens the share dialog, with a status
 * indicating whether the report has already been shared. Returns focus to the button when the dialog closes.
 */
export function ReportShareAction({ documentId, analysisId }: Readonly<{ documentId: string; analysisId: string }>) {
  const { say } = useSay();
  const [open, setOpen] = useState(false);
  const base = `/api/documents/${documentId}/analyses/${analysisId}/grants`;
  const key = [...queryKeys.document(documentId), "share", analysisId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => krizakaFetch(base, { schema: sharingStatus }),
  });
  const hasLiveShare = (list.data?.grants ?? []).some((g) => g.status === "member" || g.status === "invited");
  return (
    <>
      <Button variant="primary" size="sm" shape="cut" onClick={() => setOpen(true)} data-testid="report-share-action">
        {say("reportShare.action")}
      </Button>
      <span className="text-xs text-fg-muted" data-testid="report-share-status" aria-live="polite">
        {say(hasLiveShare ? "reportShare.shared" : "reportShare.notShared")}
      </span>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content closeLabel={say("reportShare.close")}>
          <Dialog.Header>
            <Dialog.Title>{say("reportShare.title")}</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <ReportShare documentId={documentId} analysisId={analysisId} />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
