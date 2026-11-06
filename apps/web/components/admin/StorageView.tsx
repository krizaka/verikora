"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import type { KindForm } from "@/lib/storage/admin-api";
import type { MoveView } from "@/lib/storage/provider-move";

import { formatDate } from "../console/format";
import { StorageMove } from "./StorageMove";

/** A provider as the API returns it: every secret is `set` or `not set`, never a value. */
interface ProviderView {
  id: string;
  kind: string;
  preset: string | null;
  label: string;
  coordinates: Record<string, string>;
  credentials: Record<string, "set" | "not set">;
  status: "draft" | "verified" | "active" | "retiring" | "disabled";
  source: "admin" | "env";
  lastTest: { ok: boolean; at: string; residency: { text: string } } | null;
  updatedAt: string;
}
interface Overview {
  providers: ProviderView[];
  defaults: Record<string, string>;
  kinds: KindForm[];
  move: MoveView | null;
}

const KEY = ["admin-storage"] as const;
const overview = z.custom<Overview>();
const DATA_KINDS = ["documents", "avatars", "backups"] as const;
const TONE = {
  draft: "neutral",
  verified: "accent",
  active: "success",
  retiring: "warning",
  disabled: "neutral",
} as const;

/** Every field a kind can ask for, as the form knows them: the registry says which ones a kind shows (the screen reads it, never lists a kind). */
type Field =
  | "endpoint"
  | "region"
  | "bucket"
  | "zone"
  | "pullHostname"
  | "prefix"
  | "accessKey"
  | "tokenKey"
  | "accessKeyId"
  | "secretAccessKey";
const text = z.string().trim().max(300);
const addForm = createKrizakaForm({
  schema: z.object({
    label: z.string().trim().min(1).max(80),
    endpoint: text,
    region: text,
    bucket: text,
    zone: text,
    pullHostname: text,
    prefix: text,
    accessKey: text,
    tokenKey: text,
    accessKeyId: text,
    secretAccessKey: text,
  }),
  defaultValues: {
    label: "",
    endpoint: "",
    region: "",
    bucket: "",
    zone: "",
    pullHostname: "",
    prefix: "",
    accessKey: "",
    tokenKey: "",
    accessKeyId: "",
    secretAccessKey: "",
  },
});
const keyForm = createKrizakaForm({
  schema: z.object({ value: z.string().min(1).max(500) }),
  defaultValues: { value: "" },
});

/** Runs one call of the storage API and refreshes the list; the refusal's stable code becomes a translated sentence. */
function useStep(onProblem: (message: string | null) => void) {
  const { say } = useSay();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: "POST" | "PUT" | "DELETE"; json?: unknown }) =>
      krizakaFetch(path, { method, ...(json === undefined ? {} : { json }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
    onError: (error) => onProblem(say(`errors.${errorKey(error)}`)),
  });
}

/**
 * The storage providers (ADR-005, verikora#522): where documents and avatars are kept is chosen here, in the database, not in the environment.
 * Credentials are entered once and sealed; the screen only ever reads `set` or `not set`. A provider is tested before it can be the default,
 * and its residency is shown as soon as the test has found it.
 */
export function StorageView() {
  const { say } = useSay();
  const [problem, setProblem] = useState<string | null>(null);
  const step = useStep(setProblem);
  const data = useQuery({
    queryKey: KEY,
    queryFn: () => krizakaFetch("/api/admin/storage", { schema: overview }),
    retry: false,
    refetchInterval: (query) => (query.state.data?.move?.status === "running" ? 3000 : false),
  });
  if (data.error) return <Alert tone="danger">{say(`errors.${errorKey(data.error)}`)}</Alert>;
  if (!data.data) return null;
  const { providers, defaults, kinds, move } = data.data;
  return (
    <div className="flex flex-col gap-8" data-testid="storage">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-xl font-bold text-fg">{say("adminConsole.storage.title")}</h1>
        <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConsole.storage.lead")}</p>
      </div>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {providers.length === 0 ? <Alert tone="warning">{say("adminConsole.storage.none")}</Alert> : null}
      <StorageMove
        providers={providers}
        defaultId={defaults.documents}
        move={move}
        busy={step.isPending}
        onCall={(path, json) => {
          setProblem(null);
          step.mutate({ path, method: "POST", ...(json === undefined ? {} : { json }) });
        }}
      />
      <section aria-label={say("adminConsole.storage.providers")} className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConsole.storage.providers")}</h2>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {providers.map((p) => (
            <li key={p.id}>
              <ProviderCard provider={p} defaults={defaults} onProblem={setProblem} />
            </li>
          ))}
        </ul>
      </section>
      <AddProvider kinds={kinds} onProblem={setProblem} />
    </div>
  );
}

const defaultKinds = (id: string, defaults: Record<string, string>) => DATA_KINDS.filter((k) => defaults[k] === id);

function ProviderCard({
  provider,
  defaults,
  onProblem,
}: Readonly<{ provider: ProviderView; defaults: Record<string, string>; onProblem: (m: string | null) => void }>) {
  const { say, locale } = useSay();
  const step = useStep(onProblem);
  const [changing, setChanging] = useState(false);
  const act = (path: string, method: "POST" | "PUT" | "DELETE", json?: unknown) => {
    onProblem(null);
    return step.mutateAsync({ path: `/api/admin/storage/${provider.id}${path}`, method, json });
  };
  const used = defaultKinds(provider.id, defaults);
  const secrets = Object.entries(provider.credentials);
  const usable = provider.status === "verified" || provider.status === "active";
  return (
    <article
      aria-label={provider.label}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      data-testid="storage-provider"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 font-display text-base font-bold text-fg">{provider.label}</h3>
        <Badge tone={TONE[provider.status]}>{say(`adminConsole.storage.statuses.${provider.status}`)}</Badge>
        {provider.source === "env" ? <Badge tone="neutral">{say("adminConsole.storage.fromEnvironment")}</Badge> : null}
        {used.map((k) => (
          <Badge key={k} tone="accent">
            {say("adminConsole.storage.defaultFor", { kind: say(`adminConsole.storage.dataKinds.${k}`) })}
          </Badge>
        ))}
      </header>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <Row
          label={say("adminConsole.storage.kind")}
          value={provider.preset ? `${provider.kind} · ${provider.preset}` : provider.kind}
        />
        <Row
          label={say("adminConsole.storage.residency")}
          value={provider.lastTest?.residency.text ?? say("adminConsole.storage.untested")}
        />
        {Object.entries(provider.coordinates).map(([name, value]) => (
          <Row key={name} label={say(`adminConsole.storage.fields.${name}`)} value={value} />
        ))}
        {secrets.map(([name, state]) => (
          <Row
            key={name}
            label={say(`adminConsole.storage.fields.${name}`)}
            value={say(state === "set" ? "adminConsole.storage.keySet" : "adminConsole.storage.keyNotSet")}
          />
        ))}
        <Row label={say("adminConsole.storage.lastTest")} value={lastTestText(provider, say, locale)} />
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="md" onClick={() => act("/test", "POST")}>
          {say("adminConsole.storage.test")}
        </Button>
        {DATA_KINDS.map((k) => (
          <Button
            key={k}
            variant={usable && defaults[k] !== provider.id ? "primary" : "ghost"}
            size="md"
            disabled={!usable || defaults[k] === provider.id}
            onClick={() => act("/default", "POST", { dataKind: k })}
          >
            {say("adminConsole.storage.makeDefault", { kind: say(`adminConsole.storage.dataKinds.${k}`) })}
          </Button>
        ))}
        <Button variant="ghost" size="md" onClick={() => setChanging((c) => !c)}>
          {say("adminConsole.storage.changeKey")}
        </Button>
        <Button variant="ghost" size="md" disabled={provider.status === "disabled"} onClick={() => act("", "DELETE")}>
          {say("adminConsole.storage.disable")}
        </Button>
      </div>
      {changing ? <ChangeKey provider={provider} onDone={() => setChanging(false)} onProblem={onProblem} /> : null}
    </article>
  );
}

const lastTestText = (
  p: ProviderView,
  say: ReturnType<typeof useSay>["say"],
  locale: ReturnType<typeof useSay>["locale"],
) => {
  if (!p.lastTest) return say("adminConsole.storage.untested");
  const outcome = say(p.lastTest.ok ? "adminConsole.storage.testOk" : "adminConsole.storage.testFailed");
  return outcome + " · " + formatDate(p.lastTest.at, locale, true);
};

function Row({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex gap-2">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="m-0 break-all text-fg">{value}</dd>
    </div>
  );
}

/** Replaces one credential. The value is typed once, sent once and cleared; the new key is tested before anything is saved. */
function ChangeKey({
  provider,
  onDone,
  onProblem,
}: Readonly<{ provider: ProviderView; onDone: () => void; onProblem: (m: string | null) => void }>) {
  const { say, locale } = useSay();
  const step = useStep(onProblem);
  const names = Object.keys(provider.credentials).filter((n) => n !== "encryptionKey");
  const [name, setName] = useState(names[0] ?? "");
  const form = keyForm.useForm({
    ...formI18n(say, locale),
    onSubmit: async (values) => {
      onProblem(null);
      await step.mutateAsync({
        path: `/api/admin/storage/${provider.id}/key`,
        method: "PUT",
        json: { credentials: { [name]: values.value } },
      });
      form.reset();
      onDone();
    },
  });
  return (
    <form.Form aria-label={say("adminConsole.storage.changeKey")} className="flex flex-col gap-3">
      <fieldset
        className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
        aria-label={say("adminConsole.storage.whichKey")}
      >
        {names.map((n) => (
          <Button key={n} type="button" variant={n === name ? "primary" : "ghost"} size="sm" onClick={() => setName(n)}>
            {say(`adminConsole.storage.fields.${n}`)}
          </Button>
        ))}
      </fieldset>
      <form.TextField
        name="value"
        label={say("adminConsole.storage.newKey")}
        hint={say("adminConsole.storage.newKeyHint")}
        type="password"
        autoComplete="off"
      />
      <div>
        <form.Submit size="md">{say("adminConsole.storage.saveKey")}</form.Submit>
      </div>
    </form.Form>
  );
}

/** Adds a provider: the form is drawn from the registry's kind (its fields, its presets); the provider is tested at once and stays a draft until it passes. */
function AddProvider({ kinds, onProblem }: Readonly<{ kinds: KindForm[]; onProblem: (m: string | null) => void }>) {
  const { say, locale } = useSay();
  const step = useStep(onProblem);
  const [shown, setShown] = useState(false);
  const [kindName, setKindName] = useState(kinds[0]?.kind ?? "");
  const [preset, setPreset] = useState("");
  const kind = kinds.find((k) => k.kind === kindName);
  const form = addForm.useForm({
    ...formI18n(say, locale),
    onSubmit: async (values) => {
      if (!kind) return;
      onProblem(null);
      const pick = (fields: readonly { name: string }[]) =>
        Object.fromEntries(
          fields.map((f) => [f.name, (values as Record<string, string>)[f.name] ?? ""]).filter(([, v]) => v !== ""),
        );
      const chosen = kind.presets.find((p) => p.id === preset);
      const coordinates = pick(kind.coordinates);
      if (chosen?.endpointTemplate && !coordinates.endpoint && coordinates.region)
        coordinates.endpoint = chosen.endpointTemplate.replace("{region}", coordinates.region);
      await step.mutateAsync({
        path: "/api/admin/storage",
        method: "POST",
        json: {
          kind: kind.kind,
          ...(preset ? { preset } : {}),
          label: values.label,
          coordinates,
          credentials: pick(kind.credentials),
        },
      });
      form.reset();
      setShown(false);
    },
  });
  if (!shown) {
    return (
      <div>
        <Button variant="primary" size="md" onClick={() => setShown(true)}>
          {say("adminConsole.storage.add")}
        </Button>
      </div>
    );
  }
  return (
    <section aria-label={say("adminConsole.storage.add")} className="flex flex-col gap-3" data-testid="storage-new">
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say("adminConsole.storage.add")}</h2>
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConsole.storage.addLead")}</p>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0" aria-label={say("adminConsole.storage.kind")}>
        {kinds.map((k) => (
          <Button
            key={k.kind}
            type="button"
            variant={k.kind === kindName ? "primary" : "ghost"}
            size="sm"
            onClick={() => {
              setKindName(k.kind);
              setPreset("");
            }}
          >
            {k.kind}
            {k.devOnly ? ` · ${say("adminConsole.storage.devOnly")}` : ""}
          </Button>
        ))}
      </fieldset>
      {kind && kind.presets.length > 0 ? (
        <fieldset
          className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          aria-label={say("adminConsole.storage.preset")}
        >
          {kind.presets.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant={p.id === preset ? "primary" : "ghost"}
              size="sm"
              onClick={() => setPreset(p.id)}
            >
              {p.id}
            </Button>
          ))}
        </fieldset>
      ) : null}
      <form.Form aria-label={say("adminConsole.storage.add")} className="flex flex-col gap-4">
        <form.TextField name="label" label={say("adminConsole.storage.label")} autoComplete="off" />
        {[...(kind?.coordinates ?? []), ...(kind?.credentials ?? [])].map((f) => (
          <form.TextField
            key={f.name}
            name={f.name as Field}
            label={say(`adminConsole.storage.fields.${f.name}`)}
            {...(f.type === "secret" ? { type: "password", hint: say("adminConsole.storage.enteredOnce") } : {})}
            autoComplete="off"
          />
        ))}
        <div className="flex gap-2">
          <form.Submit size="md">{say("adminConsole.storage.addSubmit")}</form.Submit>
          <Button type="button" variant="ghost" size="md" onClick={() => setShown(false)}>
            {say("adminConsole.storage.cancel")}
          </Button>
        </div>
      </form.Form>
    </section>
  );
}
