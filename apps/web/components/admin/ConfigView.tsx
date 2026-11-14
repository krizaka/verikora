"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { DataTable, type DataTableColumn } from "@krizaka/ui/data-table";
import { createKrizakaForm } from "@krizaka/ui/form";
import { RadioGroup } from "@krizaka/ui/radio-group";
import { Switch } from "@krizaka/ui/switch";
import { TagSelector } from "@krizaka/ui/tag-selector";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import type { AdminSettingDescription } from "@/lib/settings/describe";
import { type Group, KIND, SCOPE, type Scope } from "@/lib/settings/registry";
import type { AuditEntry } from "@/lib/settings/service";

type Lang = ReturnType<typeof useSay>["locale"];

const sourceOf = z.enum(["default", SCOPE.global, SCOPE.workspace, SCOPE.user]);
const settingsAnswer = z.object({
  definitions: z.array(z.custom<AdminSettingDescription>()),
  overrides: z.record(z.string(), z.unknown()),
  effective: z.record(z.string(), z.object({ value: z.unknown(), source: sourceOf })),
});
const auditAnswer = z.object({ history: z.array(z.custom<AuditEntry>()) });

export interface ScopeState {
  scope: Scope;
  id: string;
}

type Say = (key: string, vars?: Record<string, string | number>) => string;
const show = (value: unknown): string =>
  typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);

/** The settings of one group at one scope: every row says whether it is modified here or inherited, and can be reset to the default. */
export function ConfigView({ group, scope }: Readonly<{ group: Group; scope: ScopeState }>) {
  const { say } = useSay();
  const router = useRouter();
  const client = useQueryClient();
  const key = ["admin-settings", scope.scope, scope.id];
  const data = useQuery({
    queryKey: key,
    queryFn: () =>
      krizakaFetch(`/api/admin/settings?scope=${scope.scope}&id=${encodeURIComponent(scope.id)}`, {
        schema: settingsAnswer,
      }),
  });
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["admin-settings"] });
    await client.invalidateQueries({ queryKey: ["admin-settings-audit"] });
    router.refresh();
  };
  const change = useMutation({
    mutationFn: (input: { key: string; value?: unknown; reset?: boolean }) =>
      krizakaFetch("/api/admin/settings", {
        method: input.reset ? "DELETE" : "PUT",
        json: { scope: scope.scope, id: scope.id, key: input.key, ...(input.reset ? {} : { value: input.value }) },
      }),
    onSuccess: refresh,
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const rows = (data.data?.definitions ?? []).filter((d) => d.group === group);
  const apply = (k: string, value: unknown) => {
    setProblem(null);
    return change.mutateAsync({ key: k, value });
  };
  return (
    <div className="flex flex-col gap-6" data-testid={`config-${group}`}>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {rows.map((d) => (
          <li key={d.key}>
            <SettingRow
              def={d}
              scope={scope.scope}
              override={data.data?.overrides[d.key]}
              effective={data.data?.effective[d.key]}
              say={say}
              onSet={(value) => apply(d.key, value)}
              onReset={() => {
                setProblem(null);
                change.mutate({ key: d.key, reset: true });
              }}
            />
          </li>
        ))}
      </ul>
      <History />
    </div>
  );
}

const numberForm = createKrizakaForm({
  schema: z.object({ value: z.coerce.number().int() }),
  defaultValues: { value: 0 },
});
const bilingualForm = createKrizakaForm({
  schema: z.object({ fr: z.string().trim().min(1).max(500), en: z.string().trim().min(1).max(500) }),
  defaultValues: { fr: "", en: "" },
});

interface RowProps {
  def: AdminSettingDescription;
  scope: Scope;
  override: unknown;
  effective: { value: unknown; source: string } | undefined;
  say: Say;
  onSet: (value: unknown) => Promise<unknown>;
  onReset: () => void;
}

export function SettingRow(props: Readonly<RowProps>) {
  const { def, scope, override, effective, say } = props;
  const base = `adminConfig.settings.${def.key}`;
  const modified = override !== undefined;
  const allowed = def.scopes.includes(scope);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-1 p-4"
      data-testid={`setting-${def.key}`}
      data-modified={modified}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-fg">{say(`${base}.label`)}</h3>
        <span className="flex items-center gap-2">
          {modified ? (
            <Badge tone="accent">{say("adminConfig.row.modified")}</Badge>
          ) : (
            <span className="text-xs text-fg-muted">
              {say("adminConfig.row.inherited", {
                source: say(`adminConfig.sources.${effective?.source ?? "default"}`),
              })}
            </span>
          )}
          {modified ? (
            <Button size="sm" variant="ghost" onClick={props.onReset}>
              {say("adminConfig.row.reset")}
            </Button>
          ) : null}
        </span>
      </div>
      <p className="m-0 text-sm text-fg-secondary">{say(`${base}.hint`)}</p>
      {allowed ? <Control {...props} /> : <p className="m-0 text-sm text-fg-muted">{say("adminConfig.row.notHere")}</p>}
      <p className="m-0 text-xs text-fg-muted">{say("adminConfig.row.default", { value: show(def.default) })}</p>
    </div>
  );
}

function Control({ def, override, effective, say, onSet }: Readonly<RowProps>) {
  const current = override !== undefined ? override : (effective?.value ?? def.default);
  if (def.kind === KIND.flag)
    return (
      <Switch
        label={say(`adminConfig.settings.${def.key}.label`)}
        checked={current === true}
        onCheckedChange={(v: boolean) => void onSet(v)}
      />
    );
  if (def.kind === KIND.choice) {
    return (
      // @ephemeral: the value of a setting being edited (saved by onSet), not a view selection
      <RadioGroup.Root
        variant="segmented"
        label={say(`adminConfig.settings.${def.key}.label`)}
        value={String(current)}
        onValueChange={(v: string) => void onSet(v)}
      >
        {(def.choices ?? []).map((c) => (
          <RadioGroup.Segment key={c} value={c}>
            {say(`adminConfig.choices.${c}`)}
          </RadioGroup.Segment>
        ))}
      </RadioGroup.Root>
    );
  }
  if (def.kind === KIND.subset) {
    return (
      <TagSelector
        label={say(`adminConfig.settings.${def.key}.label`)}
        options={(def.choices ?? []).map((c) => ({ value: c, label: say(`adminConfig.choices.${c}`) }))}
        value={current as string[]}
        onValueChange={(v: string[]) => v.length && void onSet(v)}
      />
    );
  }
  if (def.kind === KIND.integer)
    return <IntegerControl def={def} current={current as number} say={say} onSet={onSet} />;
  return <BilingualControl current={current as { fr: string; en: string }} say={say} onSet={onSet} />;
}

function IntegerControl({
  def,
  current,
  say,
  onSet,
}: Readonly<{ def: AdminSettingDescription; current: number; say: Say; onSet: (v: unknown) => Promise<unknown> }>) {
  const { locale } = useSay();
  const form = numberForm.useForm({
    ...formI18n(say, locale),
    defaultValues: { value: current },
    onSubmit: (v) => onSet(v.value),
  });
  const name = say(`adminConfig.settings.${def.key}.label`);
  const unit = def.unit ? ` (${def.unit})` : "";
  return (
    <form.Form aria-label={name} className="flex flex-wrap items-end gap-3">
      <form.TextField name="value" label={`${name}${unit}`} inputMode="numeric" />
      <form.Submit size="md">{say("adminConfig.row.save")}</form.Submit>
    </form.Form>
  );
}

function BilingualControl({
  current,
  say,
  onSet,
}: Readonly<{ current: { fr: string; en: string }; say: Say; onSet: (v: unknown) => Promise<unknown> }>) {
  const { locale } = useSay();
  const form = bilingualForm.useForm({ ...formI18n(say, locale), defaultValues: current, onSubmit: (v) => onSet(v) });
  return (
    <form.Form aria-label="message" className="flex flex-col gap-3">
      <form.TextArea name="fr" label={say("adminConfig.row.fr")} rows={2} />
      <form.TextArea name="en" label={say("adminConfig.row.en")} rows={2} />
      <div>
        <form.Submit size="md">{say("adminConfig.row.save")}</form.Submit>
      </div>
    </form.Form>
  );
}
function auditEntryColumns(say: Say, locale: Lang): DataTableColumn<AuditEntry>[] {
  return [
    {
      id: "when",
      header: say("adminConfig.history.when"),
      value: (e) => e.at,
      cell: (e) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "medium" }).format(new Date(e.at)),
    },
    { id: "who", header: say("adminConfig.history.who"), value: (e) => e.actorLabel },
    {
      id: "what",
      header: say("adminConfig.history.what"),
      value: (e) => e.key,
      cell: (e) => <code className="text-xs">{e.key}</code>,
    },
    {
      id: "scope",
      header: say("adminConfig.history.scope"),
      value: (e) => e.scope,
      cell: (e) => {
        const source = say(`adminConfig.sources.${e.scope}`);
        return e.scopeId ? `${source} ${e.scopeId.slice(0, 8)}` : source;
      },
    },
    {
      id: "before",
      header: say("adminConfig.history.before"),
      value: (e) => show(e.before),
      cell: (e) => <code className="text-xs">{e.before === null ? "—" : show(e.before)}</code>,
    },
    {
      id: "after",
      header: say("adminConfig.history.after"),
      value: (e) => show(e.after),
      cell: (e) => <code className="text-xs">{e.after === null ? "—" : show(e.after)}</code>,
    },
  ];
}

/** Who changed what and when, before and after. */
function History() {
  const { say, locale } = useSay();
  const history = useQuery({
    queryKey: ["admin-settings-audit"],
    queryFn: () => krizakaFetch("/api/admin/settings/audit", { schema: auditAnswer }),
  });
  const columns = useMemo(() => auditEntryColumns(say, locale), [say, locale]);
  const rows = history.data?.history ?? [];
  return (
    <section
      aria-label={say("adminConfig.history.title")}
      className="flex flex-col gap-2"
      data-testid="settings-history"
    >
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConfig.history.title")}</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.history.empty")}</p>
      ) : (
        <DataTable
          caption={say("adminConfig.history.title")}
          rows={rows}
          columns={columns}
          getRowId={(e) => String(e.id)}
          rowLabel={(e) => e.key}
        />
      )}
    </section>
  );
}
