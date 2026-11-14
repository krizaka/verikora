import { ApiError } from "@krizaka/app-client";
import { useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Badge, Button, Card, Screen, Txt } from "@krizaka/ui/native";
import {
  availableChecks,
  DEFAULT_LIMITS,
  keys,
  preflight,
  PREFLIGHT_REASON,
  type PreflightReason,
} from "@verikora/client";
import { useRouter } from "expo-router";
import * as React from "react";
import { View } from "react-native";

import { queries, verikora } from "@/config";
import { deviceStore } from "@/data/expo-files";
import { uploadForm } from "@/data/upload";
import { routes } from "@/domain/links";
import { useI18n } from "@/i18n";
import { pick, SOURCE, type Source } from "@/pickers";
import { TabHeader } from "@/ui/TabHeader";
import { useLocale } from "@/use-locale";

/** Why a pick did not become a check: a refusal of the pre-flight, or the server's. */
class Refused extends Error {
  constructor(readonly reason: PreflightReason | "paywall" | "failed") {
    super(reason);
  }
}

const PAYWALL_STATUS = 402;
const CONFLICT_STATUS = 409;
const SOURCES: readonly {
  source: Source;
  label: "verify.camera" | "verify.photo" | "verify.pdf";
  variant: "primary" | "secondary";
}[] = [
  { source: SOURCE.camera, label: "verify.camera", variant: "primary" },
  { source: SOURCE.photo, label: "verify.photo", variant: "secondary" },
  { source: SOURCE.pdf, label: "verify.pdf", variant: "secondary" },
];

/**
 * Check a document: pick it (camera, photo, PDF), the web's pre-flight, the upload, the Sovkora run — then the document's
 * checks screen follows the run. The copy of the file stays in the app's sandbox.
 */
export default function Verify() {
  const { t } = useI18n();
  const { locale } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const limits = useQuery(queries.limits()).data ?? DEFAULT_LIMITS;
  const [refusal, setRefusal] = React.useState<Refused | null>(null);

  const check = useMutation({
    mutationFn: async (source: Source) => {
      const picked = await pick(source);
      if (!picked) return null;
      const result = preflight(picked, limits);
      if (!result.ok) throw new Refused(result.reason);
      const { document } = await verikora.uploadDocument(uploadForm(result.file));
      deviceStore.keep(document.id, picked.name, picked.uri);
      const [first] = availableChecks(document);
      if (!first) return { document, analysisId: null };
      try {
        return { document, analysisId: (await verikora.startAnalysis(document.id, first)).analysis.id };
      } catch (error) {
        // The same document is already being checked: its checks screen shows that run.
        if (error instanceof ApiError && error.status === CONFLICT_STATUS) return { document, analysisId: null };
        throw new Refused(error instanceof ApiError && error.status === PAYWALL_STATUS ? "paywall" : "failed");
      }
    },
    onMutate: () => setRefusal(null),
    onError: (error) => {
      setRefusal(error instanceof Refused ? error : new Refused("failed"));
    },
    onSuccess: async (done) => {
      if (!done) return;
      await queryClient.invalidateQueries({ queryKey: keys.documents() });
      const analysis = done.analysisId ? `?analysis=${done.analysisId}` : "";
      router.navigate(`${routes.document(locale, done.document.id, "rapport")}${analysis}` as never);
    },
  });

  return (
    <Screen header={<TabHeader title={t("verify.title")} />}>
      <View style={{ gap: 8 }}>
        <Txt tone="secondary">{t("verify.lead")}</Txt>
      </View>
      <View style={{ gap: 12 }}>
        {SOURCES.map(({ source, label, variant }) => (
          <Button
            key={source}
            variant={variant}
            size="lg"
            label={t(label)}
            loading={check.isPending && check.variables === source}
            disabled={check.isPending}
            onPress={() => check.mutate(source)}
          />
        ))}
      </View>
      {check.isPending ? <Txt tone="secondary">{t("verify.preparing")}</Txt> : null}
      {refusal ? (
        <Card.Root>
          <Card.Body>
            <Txt variant="label" tone="danger">
              {t("verify.refused")}
            </Txt>
            <Txt>{refusalText(refusal.reason, limits.maxFileBytes, t)}</Txt>
          </Card.Body>
        </Card.Root>
      ) : null}
      <Card.Root>
        <Card.Body>
          <Badge tone="accent">{t("verify.onDevice")}</Badge>
          <Txt tone="secondary">{t("verify.onDeviceHint")}</Txt>
        </Card.Body>
      </Card.Root>
      <Txt tone="muted" variant="caption">
        {t("disclaimer")}
      </Txt>
    </Screen>
  );
}

function refusalText(reason: Refused["reason"], maxFileBytes: number, t: ReturnType<typeof useI18n>["t"]): string {
  if (reason === "paywall") return t("verify.paywall");
  if (reason === "failed") return t("verify.failed");
  if (reason === PREFLIGHT_REASON.tooLarge)
    return t("preflight.tooLarge", { megabytes: Math.round(maxFileBytes / 1024 / 1024) });
  return t(`preflight.${reason}`);
}
