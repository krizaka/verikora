"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { PageHeader } from "@krizaka/ui/page-header";
import { RadioGroup } from "@krizaka/ui/radio-group";
import { Stepper } from "@krizaka/ui/stepper";
import { type Audience } from "@yomizaka/core";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

const STEPS = ["request", "lease", "share"] as const;
const OWNER: Audience = "landlord";

/**
 * The first run (krizaka-internal#2291, UX decision §8 kept: the app asks, never blocks, the side changes in settings): a property
 * manager starts in one click. The owner is the only card until « Autre usage » unfolds the other sides (one radio group, one
 * legend), with the three things Verikora will do next and one primary at the foot. Focus lands on the h1.
 */
export function WelcomeStart({
  audiences,
  next,
}: Readonly<{ audiences: readonly { audience: Audience; status: "available" | "soon" }[]; next: string }>) {
  const { say } = useSay();
  const router = useRouter();
  const [value, setValue] = useState<Audience>(OWNER);
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (perspective: Audience) =>
      krizakaFetch("/api/me/perspective", { method: "PUT", json: { perspective } }),
    onSuccess: () => router.replace(next),
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  // A stable callback ref: the h1 takes the focus once, when the page opens, never again on a re-render.
  const focusTitle = useCallback((root: HTMLElement | null) => {
    const title = root?.querySelector("h1");
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }, []);
  const others = audiences.filter((a) => a.audience !== OWNER);
  return (
    <div ref={focusTitle} className="mx-auto flex w-full max-w-[40rem] flex-col gap-6" data-testid="welcome">
      <PageHeader title={say("welcome.title")} />
      <RadioGroup.Root
        variant="cards"
        label={say("welcome.legend")}
        value={value}
        onValueChange={(v: string) => setValue(v as Audience)}
      >
        <RadioGroup.Item value={OWNER}>
          <span className="flex flex-col">
            <span className="font-semibold">{say("welcome.owner")}</span>
            <span className="text-sm font-normal text-fg-secondary">{say("welcome.ownerHint")}</span>
          </span>
        </RadioGroup.Item>
        {more
          ? others.map(({ audience: p, status }) => (
              <RadioGroup.Item key={p} value={p}>
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {say(`profile.${p}`)}
                    {status === "soon" ? ` (${say("profile.soon")})` : ""}
                  </span>
                  <span className="text-sm font-normal text-fg-secondary">{say(`profile.${p}Hint`)}</span>
                </span>
              </RadioGroup.Item>
            ))
          : null}
      </RadioGroup.Root>
      {others.length ? (
        <Button
          variant="ghost"
          size="md"
          className="self-start"
          aria-expanded={more}
          onClick={() => {
            setMore(!more);
            if (more) setValue(OWNER);
          }}
          data-testid="welcome-other"
        >
          {say("welcome.other")}
        </Button>
      ) : null}
      <Stepper
        orientation="vertical"
        aria-label={say("welcome.stepsLabel")}
        labels={{
          done: say("steps.state.done"),
          current: say("steps.state.current"),
          upcoming: say("steps.state.upcoming"),
          error: say("steps.state.error"),
        }}
        steps={STEPS.map((id) => ({ title: say(`welcome.steps.${id}`), status: "upcoming" as const }))}
      />
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <Button
        variant="primary"
        size="lg"
        loading={save.isPending}
        onClick={() => {
          setProblem(null);
          save.mutate(value);
        }}
        data-testid="welcome-start"
      >
        {say("welcome.start")}
      </Button>
    </div>
  );
}
