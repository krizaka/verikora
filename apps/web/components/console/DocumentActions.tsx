"use client";

import { MoreIcon } from "@krizaka/icons";
import { Button } from "@krizaka/ui/button";
import { DropdownMenu } from "@krizaka/ui/dropdown-menu";
import { useState } from "react";

import { useSay } from "@/lib/i18n-client";

import { ReportShareAction } from "./ReportShareAction";

/**
 * The document's actions: « Partager le rapport » as the primary action when a report can be shared, « Télécharger »
 * secondary; the rest in a menu (open the file, the PDF, delete); a deletion asks once more, in place.
 */
export function DocumentActions({
  fileUrl,
  reportHref,
  shareProps,
  onDelete,
  deleting,
}: Readonly<{
  fileUrl: string;
  reportHref: string | null;
  shareProps: { documentId: string; analysisId: string } | null;
  onDelete: () => void;
  deleting: boolean;
}>) {
  const { say } = useSay();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {shareProps ? <ReportShareAction {...shareProps} /> : null}
      {reportHref ? (
        <Button asChild variant={shareProps ? "secondary" : "primary"} size="sm" shape="cut" className="min-h-11">
          <a href={reportHref} download data-testid="report-download">
            {say("reportFace.downloadReport")}
          </a>
        </Button>
      ) : null}
      {confirming ? (
        <Button variant="danger" size="sm" className="min-h-11" loading={deleting} onClick={onDelete}>
          {say("document.deleteConfirm")}
        </Button>
      ) : null}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11"
            aria-label={say("document.details")}
            data-testid="document-menu"
          >
            <MoreIcon size={16} aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item asChild>
            <a href={fileUrl} target="_blank" rel="noreferrer">
              {say("document.openFile")}
            </a>
          </DropdownMenu.Item>
          {reportHref ? (
            <DropdownMenu.Item asChild>
              <a href={`${reportHref}&format=pdf`} download>
                {say("analysis.exportPdf")}
              </a>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Item tone="danger" onSelect={() => setConfirming(true)}>
            {say("document.delete")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </>
  );
}
