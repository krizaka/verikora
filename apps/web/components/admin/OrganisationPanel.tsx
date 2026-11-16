"use client";

import { type KindConfig, kindConfigProblems, type Marker, MARKERS, type StatusSet } from "@krizaka/organize/contract";
import { krizakaFetch, useMutation, useQuery } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import {
  StatusSetEditor,
  type StatusSetEditorLabels,
  TagSetEditor,
  type TagSetEditorLabels,
  type TagSetValue,
} from "@krizaka/ui/kind-config-editor";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { LIST_KINDS, type ListKind, OWNER_ROLE } from "@/lib/workspace/decl";

const storedConfig = z.object({ config: z.custom<KindConfig>(), version: z.number().int().min(1) });
const stored = z.object({ configuration: storedConfig.nullable() });
const savedAnswer = z.object({ configuration: storedConfig });

/** The preset variant the editor works on: the default tag set (a trade's variants come with the trades). */
const VARIANT = "default";

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** The words of the two editors, from the messages (both languages): the package ships English by default. */
function editorLabels(say: Say): { tags: Partial<TagSetEditorLabels>; status: Partial<StatusSetEditorLabels> } {
  const t = (key: string, vars?: Record<string, string | number>) => say(`adminConfig.organisation.${key}`, vars);
  return {
    tags: {
      presets: t("tags.presets"),
      name: (position) => t("tags.name", { position }),
      marker: (name) => t("tags.marker", { name }),
      markerNames: Object.fromEntries(MARKERS.map((m) => [m, say(`dossiers.tagsEdit.markers.${m}`)])) as Record<
        Marker,
        string
      >,
      moveUp: (name) => t("moveUp", { name }),
      moveDown: (name) => t("moveDown", { name }),
      remove: (name) => t("remove", { name }),
      drag: (name) => t("drag", { name }),
      add: t("tags.add"),
      addButton: t("tags.addButton"),
      duplicate: t("tags.duplicate"),
      empty: t("tags.empty"),
      writers: t("tags.writers"),
      writersHint: t("tags.writersHint"),
      userTags: t("tags.userTags"),
      userTagsHint: t("tags.userTagsHint"),
      max: t("tags.max"),
      maxHint: t("tags.maxHint"),
      problems: t("problems"),
    },
    status: {
      languages: { fr: t("status.languages.fr"), en: t("status.languages.en") },
      stateLabel: (language, position) => t("status.stateLabel", { language, position }),
      tone: (position) => t("status.tone", { position }),
      tones: {
        neutral: t("status.tones.neutral"),
        accent: t("status.tones.accent"),
        success: t("status.tones.success"),
        warning: t("status.tones.warning"),
        danger: t("status.tones.danger"),
      },
      final: (position) => t("status.final", { position }),
      finalHint: t("status.finalHint"),
      initial: (position) => t("status.initial", { position }),
      initialNotFinal: t("status.initialNotFinal"),
      states: t("status.states"),
      moveUp: (name) => t("moveUp", { name }),
      moveDown: (name) => t("moveDown", { name }),
      remove: (name) => t("remove", { name }),
      drag: (name) => t("drag", { name }),
      addState: t("status.addState"),
      newState: { fr: t("status.newState.fr"), en: t("status.newState.en") },
      moves: t("status.moves"),
      movesHint: t("status.movesHint"),
      from: (name) => t("status.from", { name }),
      noWayOut: t("status.noWayOut"),
      move: (from, to, roles) => t("status.move", { from, to, roles }),
      none: t("status.none"),
      moveDetail: (from, to) => t("status.moveDetail", { from, to }),
      roles: t("status.roles"),
      confirm: t("status.confirm"),
      reasons: t("status.reasons"),
      addReason: t("status.addReason"),
      reasonLabel: (language, position) => t("status.reasonLabel", { language, position }),
      removeReason: (position) => t("status.removeReason", { position }),
      derived: t("status.derived"),
      problems: t("problems"),
    },
  };
}

function KindEditor({
  kind,
  initial,
  version: first,
}: Readonly<{ kind: ListKind; initial: KindConfig; version: number }>) {
  const { say, locale } = useSay();
  const [config, setConfig] = useState(initial);
  const [version, setVersion] = useState(first);
  const [saved, setSaved] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const labels = editorLabels(say);
  const roles = [{ key: OWNER_ROLE, label: say("adminConfig.organisation.owner") }];
  const problems = kindConfigProblems(config);
  const save = useMutation({
    mutationFn: () =>
      krizakaFetch(`/api/admin/organize/${kind}/config`, {
        method: "PUT",
        json: { config, expected: version },
        schema: savedAnswer,
      }),
  });
  const submit = async () => {
    setRefused(null);
    setSaved(false);
    try {
      const answer = await save.mutateAsync();
      setVersion(answer.configuration.version);
      setSaved(true);
    } catch (error) {
      setRefused(say(`errors.${errorKey(error)}`));
    }
  };
  const edit = (next: Partial<KindConfig>) => {
    setSaved(false);
    setConfig({ ...config, ...next });
  };
  return (
    <section className="flex max-w-3xl flex-col gap-6" data-testid={`organisation-${kind}`}>
      <h2 className="m-0 font-display text-lg font-bold text-fg">{say(`adminConfig.organisation.kinds.${kind}`)}</h2>
      <TagSetEditor
        value={config.tags as TagSetValue}
        onChange={(tags) => edit({ tags })}
        variant={VARIANT}
        roles={roles}
        problems={problems}
        labels={labels.tags}
      />
      {config.status ? (
        <StatusSetEditor
          value={config.status}
          onChange={(status: StatusSet) => edit({ status })}
          roles={roles}
          locale={locale}
          problems={problems}
          labels={labels.status}
        />
      ) : null}
      {refused ? <Alert tone="danger">{refused}</Alert> : null}
      {saved ? <Alert tone="success">{say("adminConfig.organisation.saved", { version })}</Alert> : null}
      <div>
        <Button size="md" loading={save.isPending} disabled={problems.length > 0} onClick={() => void submit()}>
          {say("adminConfig.organisation.save")}
        </Button>
      </div>
    </section>
  );
}

function KindSection({ kind }: Readonly<{ kind: ListKind }>) {
  const { say } = useSay();
  const config = useQuery({
    queryKey: ["admin-organize-config", kind],
    queryFn: () => krizakaFetch(`/api/admin/organize/${kind}/config`, { schema: stored }),
  });
  if (!config.data) return null;
  const found = config.data.configuration;
  if (!found) return <p className="m-0 text-sm text-fg-secondary">{say("adminConfig.organisation.notSeeded")}</p>;
  return <KindEditor kind={kind} initial={found.config} version={found.version} />;
}

/** The vocabulary of the organised workspace — the decision set, the tag rules and presets — edited with Krizaka UI's `StatusSetEditor` and `TagSetEditor`; saved versioned (a stale editor is refused). */
export function OrganisationPanel() {
  return (
    <div className="flex flex-col gap-10" data-testid="organisation-panel">
      {LIST_KINDS.map((kind) => (
        <KindSection key={kind} kind={kind} />
      ))}
    </div>
  );
}
