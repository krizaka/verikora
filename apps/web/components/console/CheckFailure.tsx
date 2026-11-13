"use client";

import { localDay } from "@krizaka/intl";
import { krizakaFetch, useMutation, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { type Analysis, type DocumentView, queryKeys } from "@verikora/core";
import { useState } from "react";

import { ButtonLink } from "@/components/ButtonLink";
import { failureOf, retryRequest } from "@/lib/check-failure";
import { errorKey } from "@/lib/client";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { LAW_TIME_ZONE } from "@/lib/rulesets";

/**
 * A check that did not finish (krizaka-internal#1900): one status in plain words, true for this file's type and the real cause,
 * and two ways out — try again, choose another file. The engine's own sentence is never shown; it stays in the run's details.
 */
export function CheckFailure({ doc, failed }: Readonly<{ doc: DocumentView; failed: Analysis }>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const { key } = failureOf(failed.error, doc);
  const retry = useMutation({
    mutationFn: () =>
      krizakaFetch(`/api/documents/${doc.id}`, {
        method: "POST",
        json: retryRequest(failed, localDay(new Date(), LAW_TIME_ZONE)),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.document(doc.id) }),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  return (
    <div className="flex flex-col gap-3" data-testid="check-failure">
      <Alert tone="warning" title={say("checkFailure.title")}>
        {say(key)}
        {failed.creditRestored ? ` ${say("checkFailure.creditRestored")}` : null}
      </Alert>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={retry.isPending}
          onClick={() => {
            setProblem(null);
            retry.mutate();
          }}
        >
          {say(retry.isPending ? "checkFailure.retrying" : "checkFailure.retry")}
        </Button>
        <ButtonLink href={`/${locale}${CONSOLE_ROUTES.check}`} variant="secondary">
          {say("checkFailure.chooseFile")}
        </ButtonLink>
      </div>
    </div>
  );
}
