"use client";

import { krizakaFetch, useMutation, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { createKrizakaForm } from "@krizaka/ui/form";
import { RadioGroup } from "@krizaka/ui/radio-group";
import { Switch } from "@krizaka/ui/switch";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import type { AdminFlow } from "@/lib/flows";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import { SCOPE, type Scope } from "@/lib/settings/registry";

import type { ScopeState } from "./ConfigView";

const SCOPE_CHOICES = [SCOPE.global, SCOPE.workspace, SCOPE.user] as const;

/** The scope the settings are shown and changed at: global, a workspace or a person — it is in the URL (`?scope=user&id=…`). */
const idForm = createKrizakaForm({
  schema: z.object({ id: z.string().trim().min(1).max(80) }),
  defaultValues: { id: "" },
});

function ScopeId({ scope, onGo }: Readonly<{ scope: ScopeState; onGo: (scope: Scope, id: string) => void }>) {
  const { say, locale } = useSay();
  const form = idForm.useForm({
    ...formI18n(say, locale),
    defaultValues: { id: scope.id },
    onSubmit: (v) => onGo(scope.scope, v.id),
  });
  return (
    <form.Form aria-label={say("adminConfig.scope.label")} className="flex flex-wrap items-end gap-2">
      <form.TextField
        name="id"
        label={say("adminConfig.scope.id")}
        placeholder={say("adminConfig.scope.idHint")}
        autoComplete="off"
      />
      <form.Submit size="md" variant="secondary">
        {say("adminConfig.scope.apply")}
      </form.Submit>
    </form.Form>
  );
}

export function ScopeBar({ scope }: Readonly<{ scope: ScopeState }>) {
  const { say } = useSay();
  const router = useRouter();
  const path = usePathname() ?? "";
  const id = scope.id;
  const go = (next: Scope, nextId: string) =>
    router.push(next === SCOPE.global ? path : `${path}?scope=${next}&id=${encodeURIComponent(nextId)}`);
  return (
    <section aria-label={say("adminConfig.scope.label")} className="flex flex-col gap-2" data-testid="scope-bar">
      {/* @ephemeral: already in the URL (?scope=&id=, two linked parameters written by go()) */}
      <RadioGroup.Root
        variant="segmented"
        label={say("adminConfig.scope.label")}
        value={scope.scope}
        onValueChange={(v: string) => go(v as Scope, v === SCOPE.global ? "" : id)}
      >
        {SCOPE_CHOICES.map((s) => (
          <RadioGroup.Segment key={s} value={s}>
            {say(`adminConfig.scope.${s}`)}
          </RadioGroup.Segment>
        ))}
      </RadioGroup.Root>
      {scope.scope === SCOPE.global ? null : <ScopeId key={scope.scope} scope={scope} onGo={go} />}
      <p className="m-0 text-xs text-fg-muted">
        {say("adminConfig.scope.resolution")}{" "}
        {scope.scope === SCOPE.workspace ? say("adminConfig.scope.workspaceNote") : ""}
      </p>
    </section>
  );
}

/** Each rules pack is a flow: this turns it on or off in an environment, at once (the same switch as the flows page). */
export function PacksPanel({ flows, environment }: Readonly<{ flows: AdminFlow[]; environment: "dev" | "prod" }>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      krizakaFetch(`/api/admin/flows/${input.id}/environments`, {
        method: "PUT",
        json: { environment, enabled: input.enabled },
      }),
    onSuccess: () => router.refresh(),
    onError: () => setProblem(say("errors.UNKNOWN")),
  });
  return (
    <section className="flex flex-col gap-3" data-testid="packs-panel">
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.packs.lead")}</p>
      <p className="m-0 text-sm">
        {say("adminConfig.packs.environment")}: <Badge tone="accent">{environment}</Badge>
      </p>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {flows.length === 0 ? <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.packs.empty")}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {flows.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-default bg-surface-1 p-4"
            data-testid={`pack-${f.key}`}
          >
            <span className="flex flex-col">
              <span className="font-semibold text-fg">{f.title}</span>
              <code className="text-xs text-fg-muted">{f.key}</code>
            </span>
            <Switch
              label={`${say("adminConfig.packs.enabled")}: ${f.key}`}
              checked={f.environments[environment]}
              onCheckedChange={(v: boolean) => toggle.mutate({ id: f.id, enabled: v })}
            />
          </li>
        ))}
      </ul>
      <div>
        <Button asChild variant="ghost" size="md">
          <Link href={`/${locale}/flows`}>{say("adminConfig.packs.manage")}</Link>
        </Button>
      </div>
    </section>
  );
}

const sovkoraStatus = z.object({
  key: z.object({ configured: z.boolean(), masked: z.string().nullable() }),
  baseUrl: z.string(),
  usage: z.object({ runs: z.number(), failed: z.number(), estimatedCostCents: z.number() }),
});
const sovkoraTest = z.object({
  ok: z.boolean(),
  ms: z.number(),
  code: z.string().optional(),
  studios: z.array(z.string()),
});

/** This product's connection to Sovkora: key (masked), address, a connection test, and this month's usage as recorded here. */
export function SovkoraPanel() {
  const { say, locale } = useSay();
  const status = useQuery({
    queryKey: ["admin-sovkora"],
    queryFn: () => krizakaFetch("/api/admin/sovkora", { schema: sovkoraStatus }),
  });
  const test = useMutation({
    mutationFn: () => krizakaFetch("/api/admin/sovkora/test", { method: "POST", schema: sovkoraTest }),
  });
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(cents / 100);
  if (!status.data) return null;
  const { key, baseUrl, usage } = status.data;
  const result = test.data;
  return (
    <section className="flex max-w-2xl flex-col gap-4" data-testid="sovkora-panel">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.sovkora.keyTitle")}</h2>
        <p className="m-0 text-sm text-fg-secondary" data-testid="sovkora-key">
          {key.configured
            ? say("adminConfig.sovkora.masked", { key: key.masked ?? "" })
            : say("adminConfig.sovkora.none")}
        </p>
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.sovkora.address", { url: baseUrl })}</p>
        <p className="m-0 text-xs text-fg-muted">{say("adminConfig.sovkora.rotate")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <div>
          <Button size="md" variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? say("adminConfig.sovkora.testing") : say("adminConfig.sovkora.test")}
          </Button>
        </div>
        {result ? (
          <Alert tone={result.ok ? "success" : "danger"}>
            {result.ok
              ? say("adminConfig.sovkora.ok", { ms: result.ms, count: result.studios.length })
              : say("adminConfig.sovkora.fail", { code: result.code ?? "?" })}
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.sovkora.usageTitle")}</h2>
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.sovkora.runs", { count: usage.runs })}</p>
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.sovkora.failed", { count: usage.failed })}</p>
        <p className="m-0 text-sm text-fg-secondary">
          {say("adminConfig.sovkora.cost", { amount: money(usage.estimatedCostCents) })}
        </p>
        <p className="m-0 text-xs text-fg-muted">{say("adminConfig.sovkora.notExposed")}</p>
      </div>
    </section>
  );
}
