"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useMemo, useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";

import { formatDate } from "../console/format";

type Say = ReturnType<typeof useSay>["say"];
type Lang = ReturnType<typeof useSay>["locale"];

interface Invitation {
  id: string;
  email: string;
  grant: { kind: string; ref: string } | null;
  createdAt: string;
  expiresAt: string;
}
interface Pilot {
  id: string;
  code: string;
  credits: number;
  validDays: number;
  usesLeft: number | null;
}

const list = z.object({ invitations: z.array(z.custom<Invitation>()), pilots: z.array(z.custom<Pilot>()) });
const KEY = ["admin-invitations"];
const LOCALES = ["fr", "en"] as const;

const inviteForm = createKrizakaForm({
  schema: z.object({
    email: z.string().trim().min(1).email().max(254),
    pilotCouponId: z.string(),
    locale: z.enum(LOCALES),
  }),
  defaultValues: { email: "", pilotCouponId: "", locale: "fr" as (typeof LOCALES)[number] },
});

/**
 * « Invite a property manager » (krizaka-internal#3230): while sign-up is closed, the admin invites an address, optionally with one of the live pilot coupons (a select of
 * data, never a typed code); the open invitations can be sent again (a new link) or revoked. Every action is on the audit trail; the link is in the mail only.
 */
export function InvitationsView() {
  const { say } = useSay();
  const data = useQuery({ queryKey: KEY, queryFn: () => krizakaFetch("/api/admin/invitations", { schema: list }) });
  if (!data.data) {
    return null;
  }
  return (
    <div className="flex flex-col gap-8" data-testid="invitations">
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.invitations.lead")}</p>
      <InviteForm pilots={data.data.pilots} />
      <PendingTable invitations={data.data.invitations} />
    </div>
  );
}

function InviteForm({ pilots }: Readonly<{ pilots: Pilot[] }>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = inviteForm.useForm({
    ...formI18n(say, locale),
    defaultValues: { email: "", pilotCouponId: "", locale },
    onSubmit: async (values) => {
      setProblem(null);
      setSentTo(null);
      try {
        await krizakaFetch("/api/admin/invitations", {
          method: "POST",
          json: {
            email: values.email,
            locale: values.locale,
            ...(values.pilotCouponId ? { pilotCouponId: values.pilotCouponId } : {}),
          },
        });
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
        throw error;
      }
      setSentTo(values.email);
      form.reset();
      await client.invalidateQueries({ queryKey: KEY });
    },
  });
  const pilotLabel = (p: Pilot) =>
    say(p.usesLeft === null ? "adminConfig.invitations.pilotOption" : "adminConfig.invitations.pilotOptionLeft", {
      code: p.code,
      credits: p.credits,
      days: p.validDays,
      left: p.usesLeft ?? 0,
    });
  return (
    <section aria-labelledby="invite-title" className="flex max-w-xl flex-col gap-3" data-testid="invite-new">
      <h2 id="invite-title" className="m-0 font-display text-lg font-bold text-fg">
        {say("adminConfig.invitations.new")}
      </h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {sentTo ? <Alert tone="success">{say("adminConfig.invitations.sent", { email: sentTo })}</Alert> : null}
      <form.Form aria-label={say("adminConfig.invitations.new")} className="flex flex-col gap-4">
        <form.TextField name="email" label={say("adminConfig.invitations.email")} type="email" autoComplete="off" />
        <form.Select
          name="pilotCouponId"
          label={say("adminConfig.invitations.pilot")}
          hint={say(pilots.length ? "adminConfig.invitations.pilotHint" : "adminConfig.invitations.noPilots")}
          placeholder={say("adminConfig.invitations.noPilot")}
          options={pilots.map((p) => ({ value: p.id, label: pilotLabel(p) }))}
        />
        <form.Select
          name="locale"
          label={say("adminConfig.invitations.locale")}
          options={LOCALES.map((l) => ({ value: l, label: say(`adminConfig.invitations.locales.${l}`) }))}
        />
        <div>
          <form.Submit size="md">{say("adminConfig.invitations.send")}</form.Submit>
        </div>
      </form.Form>
    </section>
  );
}

function columns(
  say: Say,
  locale: Lang,
  act: (id: string, action: "resend" | "revoke") => void,
  busy: boolean,
): DataTableColumn<Invitation>[] {
  return [
    { id: "email", header: say("adminConfig.invitations.email"), sortable: true, card: "title", value: (i) => i.email },
    {
      id: "pilot",
      header: say("adminConfig.invitations.pilot"),
      value: (i) => i.grant?.ref ?? "",
      cell: (i) => (i.grant ? <code className="font-mono text-xs">{i.grant.ref}</code> : "—"),
    },
    {
      id: "sent",
      header: say("adminConfig.invitations.sentOn"),
      sortable: true,
      value: (i) => i.createdAt,
      cell: (i) => formatDate(i.createdAt, locale),
    },
    {
      id: "expires",
      header: say("adminConfig.invitations.expiresOn"),
      value: (i) => i.expiresAt,
      cell: (i) => formatDate(i.expiresAt, locale),
    },
    {
      id: "actions",
      header: say("adminConfig.invitations.actions"),
      headerHidden: true,
      value: () => "",
      cell: (i) => (
        <span className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={say("adminConfig.invitations.resendTo", { email: i.email })}
            onClick={() => act(i.id, "resend")}
          >
            {say("adminConfig.invitations.resend")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={say("adminConfig.invitations.revokeFor", { email: i.email })}
            onClick={() => act(i.id, "revoke")}
          >
            {say("adminConfig.invitations.revoke")}
          </Button>
        </span>
      ),
    },
  ];
}

function PendingTable({ invitations }: Readonly<{ invitations: Invitation[] }>) {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "resend" | "revoke" }) =>
      krizakaFetch(`/api/admin/invitations/${id}`, {
        method: "POST",
        json: action === "resend" ? { action, locale } : { action },
      }),
    onSuccess: () => {
      setProblem(null);
      return client.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const cols = useMemo(
    () => columns(say, locale, (id, action) => change.mutate({ id, action }), change.isPending),
    [say, locale, change],
  );
  return (
    <section aria-labelledby="invitations-title" className="flex flex-col gap-2">
      <h2 id="invitations-title" className="m-0 font-display text-lg font-bold text-fg">
        {say("adminConfig.invitations.pending")}
      </h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {invitations.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.invitations.empty")}</p>
      ) : (
        <DataTable
          caption={say("adminConfig.invitations.pending")}
          rows={invitations}
          columns={cols}
          getRowId={(i) => i.id}
          rowLabel={(i) => i.email}
        />
      )}
    </section>
  );
}
