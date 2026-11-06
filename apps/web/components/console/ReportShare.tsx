"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { createKrizakaForm } from "@krizaka/ui/form";
import { queryKeys } from "@verikora/core";
import { useEffect, useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

import { formatDate } from "./format";

const sharing = z.object({
  grants: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      status: z.enum(["member", "invited", "expired", "revoked"]),
      createdAt: z.string(),
      expiresAt: z.string().nullable(),
    }),
  ),
  requests: z.array(z.object({ id: z.string(), email: z.string(), createdAt: z.string() })),
});

const share = createKrizakaForm({
  schema: z.object({ email: z.string().trim().min(1).email(), until: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/) }),
  defaultValues: { email: "", until: "" },
});

const TONE = { member: "success", invited: "accent", expired: "neutral", revoked: "neutral" } as const;

/**
 * Who may verify this report (ADR-0002). The owner shares it by e-mail, optionally until a date; a member has access at
 * once, an address without an account is an invitation honoured when the account exists. Grants can be revoked, and a
 * « request access » from a member appears here to be accepted in one click.
 */
export function ReportShare({ documentId, analysisId }: Readonly<{ documentId: string; analysisId: string }>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const base = `/api/documents/${documentId}/analyses/${analysisId}/grants`;
  const key = [...queryKeys.document(documentId), "share", analysisId];
  const [problem, setProblem] = useState<string | null>(null);
  const list = useQuery({ queryKey: key, queryFn: () => krizakaFetch(base, { schema: sharing }) });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: (body: { email: string; expiresAt: string | null }) =>
      krizakaFetch(base, { method: "POST", json: body }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => krizakaFetch(`${base}/${grantId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const form = share.useForm({
    i18n: { t: (k, vars) => say(k, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await add.mutateAsync({
          email: values.email,
          expiresAt: values.until ? new Date(`${values.until}T23:59:59`).toISOString() : null,
        });
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  });
  // A shared address leaves the form empty for the next one.
  useEffect(() => {
    if (!add.isSuccess) return;
    form.reset();
    add.reset();
  }, [add, add.isSuccess, form]);
  const live = list.data?.grants.filter((g) => g.status === "member" || g.status === "invited") ?? [];
  return (
    <div className="flex flex-col gap-3 border-t border-border-default pt-3" data-testid="report-share">
      <h4 className="text-sm font-semibold text-fg">{say("share.title")}</h4>
      <p className="text-xs text-fg-secondary">{say("share.hint")}</p>
      {list.data?.requests.length ? (
        <Alert tone="info" title={say("share.requestsTitle")}>
          <ul className="mt-1 flex flex-col gap-2">
            {list.data.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {r.email} · <span className="text-fg-muted">{formatDate(r.createdAt, locale)}</span>
                </span>
                <Button size="sm" onClick={() => add.mutate({ email: r.email, expiresAt: null })}>
                  {say("share.accept")}
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <form.Form aria-label={say("share.title")} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form.TextField name="email" label={say("share.email")} type="email" autoComplete="off" />
        <form.DateField name="until" label={say("share.until")} />
        <form.Submit size="md">{say("share.submit")}</form.Submit>
      </form.Form>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {live.length === 0 && list.data ? <p className="text-xs text-fg-muted">{say("share.none")}</p> : null}
      <ul className="flex flex-col gap-2">
        {(list.data?.grants ?? []).map((g) => (
          <li
            key={g.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-1 p-2 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-all">{g.email}</span>
              <Badge tone={TONE[g.status]}>{say(`share.status.${g.status}`)}</Badge>
              {g.expiresAt ? (
                <span className="text-xs text-fg-muted">
                  {say("share.until")} {formatDate(g.expiresAt, locale)}
                </span>
              ) : null}
            </span>
            {g.status === "member" || g.status === "invited" ? (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(g.id)}>
                {say("share.revoke")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
