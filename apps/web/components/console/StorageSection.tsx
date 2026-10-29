"use client";

import { krizakaFetch, useMutation, useQuery } from "@krizaka/query";
import { ChoiceCards } from "@krizaka/ui/account-settings";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { createKrizakaForm } from "@krizaka/ui/form";
import { SettingsRow, SettingsSection } from "@krizaka/ui/settings-layout";
import { Switch } from "@krizaka/ui/switch";
import { STORAGE_MODE, STORAGE_MODES, type StorageMode } from "@yomizaka/core";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import { storageCards } from "@/lib/storage/cards";


const step = z.object({ name: z.enum(["write", "read", "delete"]), ok: z.boolean(), ms: z.number(), error: z.string().optional() });
const verification = z.object({ verification: z.object({ ok: z.boolean(), steps: z.array(step), host: z.string().nullable(), region: z.string(), residency: z.enum(["canada", "elsewhere"]), error: z.string().nullable() }) });
const current = z.object({
  settings: z.object({ mode: z.enum(STORAGE_MODES), keepDefault: z.boolean(), cloud: z.object({ connector: z.string(), connected: z.boolean() }).nullable().default(null), s3: z.object({ endpoint: z.string(), region: z.string(), bucket: z.string(), accessKeyId: z.string(), hasSecret: z.boolean() }).nullable(), testedAt: z.string().nullable() }),
  canStoreCredentials: z.boolean(),
  /** The clouds the deployment holds a registration for and the administrator opened (empty: the cloud panel is hidden). */
  clouds: z.array(z.string()).default([]),
});
const cloudStart = z.object({ url: z.string().url() });

const s3Form = createKrizakaForm({
  schema: z.object({ endpoint: z.string().trim().min(1), region: z.string().trim().min(1), bucket: z.string().trim().min(1), accessKeyId: z.string().trim().min(1), secretAccessKey: z.string().max(400) }),
  defaultValues: { endpoint: "", region: "", bucket: "", accessKeyId: "", secretAccessKey: "" },
});

type Verification = z.infer<typeof verification>["verification"];

/** Where the documents a person keeps live: nothing, Krizaka's store, or their own S3 — verified (write, read, delete) before it is saved. */
export function StorageSection() {
  const { say, locale } = useSay();
  const router = useRouter();
  const info = useQuery({ queryKey: ["storage-settings"], queryFn: () => krizakaFetch("/api/me/storage", { schema: current }), staleTime: 0 });
  if (!info.data) return null;
  const refresh = () => { void info.refetch(); router.refresh(); };
  const { settings, clouds } = info.data;
  // A connected cloud is the home of the kept documents: its panel replaces the choice until the person disconnects it.
  if (settings.mode === STORAGE_MODE.cloud) return <CloudPanel settings={settings} clouds={clouds} say={say} onChanged={refresh} />;
  return (
    <>
      <StorageForm key={settings.testedAt ?? "new"} initial={settings} canStoreCredentials={info.data.canStoreCredentials} say={say} locale={locale} onSaved={refresh} />
      {clouds.length > 0 || settings.cloud ? <CloudPanel settings={settings} clouds={clouds} say={say} onChanged={refresh} /> : null}
    </>
  );
}

const CLOUD_NAME_OF: Readonly<Record<string, string>> = { dropbox: "dropbox", google: "google-drive", microsoft: "onedrive" };
const CLOUD_LABEL_KEY = (connector: string) => `settings.storage.clouds.${connector}`;

/** The return of the provider's consent screen: `?cloud=connected`, or the reason it did not end in a connection. */
function CloudResult({ say }: Readonly<{ say: Say }>) {
  const result = useSearchParams().get("cloud");
  if (!result) return null;
  if (result === "connected") return null; // the connected panel says it
  return <Alert tone="danger">{say(result === "denied" ? "settings.storage.cloudResultDenied" : "settings.storage.cloudResultFailed")}</Alert>;
}

/** Connect a cloud the person already has (Dropbox, Google Drive, OneDrive): the provider's own consent screen, the app's folder only; and disconnect it. */
function CloudPanel({ settings, clouds, say, onChanged }: Readonly<{ settings: z.infer<typeof current>["settings"]; clouds: string[]; say: Say; onChanged: () => void }>) {
  const [problem, setProblem] = useState<string | null>(null);
  const connect = useMutation({ mutationFn: (cloud: string) => krizakaFetch(`/api/me/storage/cloud/${cloud}`, { method: "POST", schema: cloudStart }) });
  const disconnect = useMutation({ mutationFn: () => krizakaFetch("/api/me/storage/cloud/disconnect", { method: "POST" }) });
  const go = async (cloud: string) => {
    setProblem(null);
    try {
      window.location.assign((await connect.mutateAsync(cloud)).url);
    } catch (error) {
      setProblem(say(`errors.${errorKey(error)}`));
    }
  };
  const leave = async () => {
    setProblem(null);
    try {
      await disconnect.mutateAsync();
      onChanged();
    } catch (error) {
      setProblem(say(`errors.${errorKey(error)}`));
    }
  };
  const label = settings.cloud ? say(CLOUD_LABEL_KEY(settings.cloud.connector)) : "";
  return (
    <SettingsSection variant="flat" title={say(settings.cloud?.connected ? "settings.storage.cloudTitleConnected" : "settings.storage.cloudTitle")} description={say("settings.storage.cloudLead")} data-testid="settings-cloud">
      <div className="flex flex-col gap-3">
      <Suspense fallback={null}><CloudResult say={say} /></Suspense>
      {settings.cloud?.connected ? (
        <>
          <Alert tone="success">{say("settings.storage.cloudConnected", { cloud: label })}</Alert>
          <div><Button type="button" variant="secondary" size="md" loading={disconnect.isPending} onClick={leave}>{say("settings.storage.cloudDisconnect")}</Button></div>
        </>
      ) : (
        <>
          {settings.cloud ? <Alert tone="warning">{say("settings.storage.cloudWasDisconnected", { cloud: label })}</Alert> : null}
          <div className="flex flex-wrap gap-3">
            {Object.entries(CLOUD_NAME_OF).filter(([id]) => clouds.includes(id)).map(([id, connector]) => (
              <Button key={id} type="button" variant="secondary" size="md" loading={connect.isPending && connect.variables === id} onClick={() => go(id)}>
                {say("settings.storage.cloudConnect", { cloud: say(CLOUD_LABEL_KEY(connector)) })}
              </Button>
            ))}
          </div>
          <p className="m-0 text-sm text-fg-secondary">{say("settings.storage.cloudScope")}</p>
        </>
      )}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </div>
    </SettingsSection>
  );
}

type Say = (k: string, v?: Record<string, string | number>) => string;
type S3Settings = z.infer<typeof current>["settings"]["s3"];

const STEP_KEY = { write: "stepWrite", read: "stepRead", delete: "stepDelete" } as const;

function s3Defaults(s3: S3Settings) {
  return { endpoint: s3?.endpoint ?? "", region: s3?.region ?? "", bucket: s3?.bucket ?? "", accessKeyId: s3?.accessKeyId ?? "", secretAccessKey: "" };
}

function stepOutcome(s: Verification["steps"][number], say: Say): string {
  if (s.ok) return say("settings.storage.stepOk");
  const detail = s.error ? ` (${s.error})` : "";
  return `${say("settings.storage.stepFail")}${detail}`;
}

/** What the connection test did, step by step, and where the bucket sits. */
function ConnectionResult({ verified, say }: Readonly<{ verified: Verification; say: Say }>) {
  const canada = verified.residency === "canada";
  return (
    <div className="flex flex-col gap-2" data-testid="connection-result">
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {verified.steps.map((s) => (
          <li key={s.name} className={s.ok ? "text-fg" : "text-danger"}>
            {s.ok ? "✓" : "✕"} {say(`settings.storage.${STEP_KEY[s.name]}`)} · {stepOutcome(s, say)}
          </li>
        ))}
      </ul>
      {verified.ok && verified.host ? <Alert tone={canada ? "success" : "warning"}>{say(canada ? "settings.storage.whereCanada" : "settings.storage.whereElsewhere", { host: verified.host, region: verified.region })}</Alert> : null}
    </div>
  );
}

function StorageForm({ initial, canStoreCredentials, say, locale, onSaved }: Readonly<{ initial: z.infer<typeof current>["settings"]; canStoreCredentials: boolean; say: (k: string, v?: Record<string, string | number>) => string; locale: string; onSaved: () => void }>) {
  const [mode, setMode] = useState<StorageMode>(initial.mode);
  const [keepDefault, setKeepDefault] = useState(initial.keepDefault);
  const [verified, setVerified] = useState<Verification | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const values = () => form.getValues() as { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  const body = () => ({ ...values(), secretAccessKey: values().secretAccessKey || undefined });
  const test = useMutation({ mutationFn: () => krizakaFetch("/api/me/storage/test", { method: "POST", json: body(), schema: verification }) });
  const save = useMutation({ mutationFn: () => krizakaFetch("/api/me/storage", { method: "PUT", json: { mode, keepDefault: mode === STORAGE_MODE.none ? false : keepDefault, ...(mode === STORAGE_MODE.s3 ? { s3: body() } : {}) } }) });
  const form = s3Form.useForm({
    ...formI18n(say, locale),
    defaultValues: s3Defaults(initial.s3),
    onSubmit: async () => {
      setProblem(null);
      setSaved(false);
      try {
        await save.mutateAsync();
        setSaved(true);
        onSaved();
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  });
  const runTest = async () => {
    setProblem(null);
    setVerified(null);
    try {
      const out = await test.mutateAsync();
      setVerified(out.verification);
      if (out.verification.error) setProblem(say(`errors.${out.verification.error}`));
    } catch (error) {
      setProblem(say(`errors.${errorKey(error)}`));
    }
  };
  const needsTest = mode === STORAGE_MODE.s3 && !verified?.ok;
  return (
    <SettingsSection variant="flat" title={say("settings.storage.title")} description={say("settings.storage.lead")} data-testid="settings-stockage">
      {/* A connected cloud is not a card: it is connected from its own panel below. The person's own S3 is offered only where this installation can keep its credentials (the review's E4): never a choice that cannot be taken. */}
      <ChoiceCards
        label={say("settings.storage.modeLabel")}
        options={storageCards(canStoreCredentials).map((m) => ({ id: m, title: say(`settings.storage.${m}`), description: say(`settings.storage.${m}Hint`) }))}
        value={mode}
        onValueChange={(v) => {
          setMode(v as StorageMode);
          setSaved(false);
          setVerified(null);
        }}
      />
      <form.Form aria-label={say("settings.storage.title")} className="flex flex-col gap-4">
        {mode === STORAGE_MODE.s3 ? (
          <>
            <form.TextField name="endpoint" label={say("settings.storage.endpoint")} type="url" autoComplete="off" placeholder="https://s3.example.com" />
            <div className="grid gap-4 sm:grid-cols-2">
              <form.TextField name="region" label={say("settings.storage.region")} autoComplete="off" placeholder="ca-central-1" />
              <form.TextField name="bucket" label={say("settings.storage.bucket")} autoComplete="off" />
            </div>
            <form.TextField name="accessKeyId" label={say("settings.storage.accessKeyId")} autoComplete="off" />
            <form.TextField name="secretAccessKey" label={say("settings.storage.secretAccessKey")} type="password" autoComplete="off" hint={initial.s3?.hasSecret ? say("settings.storage.secretSaved") : say("settings.storage.secretHint")} />
            <p className="m-0 text-sm text-fg-secondary">{say("settings.storage.steps")}</p>
            <div>
              <Button type="button" variant="secondary" size="md" loading={test.isPending} onClick={runTest}>
                {say("settings.storage.test")}
              </Button>
            </div>
            {verified && verified.steps.length > 0 ? <ConnectionResult verified={verified} say={say} /> : null}
          </>
        ) : null}
        {mode === STORAGE_MODE.none ? null : (
          <SettingsRow label={say("settings.storage.keepDefault")} htmlFor="keep-default">
            <Switch id="keep-default" label={say("settings.storage.keepDefault")} checked={keepDefault} onCheckedChange={(v) => { setKeepDefault(v === true); setSaved(false); }} />
          </SettingsRow>
        )}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {needsTest ? <p className="m-0 text-sm text-fg-secondary">{say("settings.storage.testRequired")}</p> : null}
        <div className="flex items-center gap-3">
          <form.Submit size="md" disabled={needsTest}>{say("settings.storage.save")}</form.Submit>
          {saved ? <output className="text-sm text-fg-secondary">{say("settings.storage.saved")}</output> : null}
        </div>
      </form.Form>
    </SettingsSection>
  );
}
