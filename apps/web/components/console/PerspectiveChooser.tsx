"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Card } from "@krizaka/ui/card";
import { RadioGroup } from "@krizaka/ui/radio-group";
import { type Audience } from "@verikora/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

/**
 * Which side of the lease the person is on: asked once at onboarding (its own route, /app/welcome, saved on selection) and
 * changeable in settings. It changes the checks offered first and the wording, never the rules.
 */
export function PerspectiveChooser({
  current,
  audiences,
  onboarding = false,
  next,
}: Readonly<{
  current: Audience | null;
  audiences: readonly { audience: Audience; status: "available" | "soon" }[];
  onboarding?: boolean;
  next?: string;
}>) {
  const { say } = useSay();
  const router = useRouter();
  const [value, setValue] = useState<Audience | null>(current);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (perspective: Audience) =>
      krizakaFetch("/api/me/perspective", { method: "PUT", json: { perspective } }),
    onSuccess: () => {
      setSaved(true);
      if (next) router.replace(next);
      else router.refresh();
    },
  });
  return (
    <Card.Root
      className="flex flex-col gap-3 p-4"
      data-testid={onboarding ? "perspective-onboarding" : "perspective-settings"}
    >
      <h2 className="font-display text-lg font-bold text-fg">{say("profile.title")}</h2>
      <p className="text-sm text-fg-secondary">{say("profile.lead")}</p>
      <RadioGroup.Root
        label={say("profile.legend")}
        value={value ?? ""}
        onValueChange={async (v: string) => {
          setSaved(false);
          setValue(v as Audience);
          if (!onboarding) return;
          setProblem(null);
          try {
            await save.mutateAsync(v as Audience);
          } catch (error) {
            setProblem(say(`errors.${errorKey(error)}`));
          }
        }}
      >
        {audiences.map(({ audience: p, status }) => (
          <RadioGroup.Item key={p} value={p}>
            <span className="flex flex-col">
              <span className="font-semibold">
                {say(`profile.${p}`)}
                {status === "soon" ? ` (${say("profile.soon")})` : ""}
              </span>
              <span className="text-sm font-normal text-fg-secondary">{say(`profile.${p}Hint`)}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {onboarding ? null : (
        <div className="flex items-center gap-3">
          <Button
            size="md"
            disabled={!value || value === current}
            loading={save.isPending}
            onClick={async () => {
              setProblem(null);
              try {
                await save.mutateAsync(value!);
              } catch (error) {
                setProblem(say(`errors.${errorKey(error)}`));
              }
            }}
          >
            {say("profile.save")}
          </Button>
          {saved ? <output className="text-sm text-fg-secondary">{say("profile.saved")}</output> : null}
        </div>
      )}
    </Card.Root>
  );
}
