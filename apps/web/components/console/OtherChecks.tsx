"use client";

import type { Analysis } from "@verikora/core";

import { useSay } from "@/lib/i18n-client";
import type { RegistryReport } from "@/lib/registries/report";
import type { Answer } from "@/lib/signal-answers";

import { AuthenticitySignals } from "./AuthenticitySignals";
import { formatDate } from "./format";
import { RegistryChecks } from "./RegistryChecks";

type PeerState = "done" | "running" | "failed" | "notYet";

/** The state of a check in one word: done, running, failed (an older failure behind a result is history), or not done yet. */
export function peerState(latest: Analysis | undefined, running: boolean, failed: boolean): PeerState {
  if (latest) {
    return "done";
  }
  if (running) {
    return "running";
  }
  return failed ? "failed" : "notYet";
}

/**
 * The other checks of the same document (the review's « Autres vérifications », krizaka-internal#2293): each is a peer of the
 * lease report with its state in words — authenticity (the file examined as a file) and the business registers — never a section
 * of the lease report. A check that is done opens its own traces in a fold; the others are started from the aside.
 */
export function OtherChecks({
  authenticity,
  authenticityRunning,
  authenticityFailed,
  registry,
  answers,
}: Readonly<{
  authenticity: Analysis | undefined;
  authenticityRunning: boolean;
  authenticityFailed: boolean;
  registry: RegistryReport | null;
  answers?: Record<string, Answer>;
}>) {
  const { say, locale } = useSay();
  const traces = authenticity?.report && "signals" in authenticity.report ? authenticity.report : null;
  const state = peerState(traces ? authenticity : undefined, authenticityRunning, authenticityFailed);
  const signals = traces?.signals.length ?? 0;
  const doneKey = signals === 1 ? "reportFace.peer.doneOne" : "reportFace.peer.doneMany";
  const finished = authenticity ? (authenticity.finishedAt ?? authenticity.createdAt) : "";
  const authenticityWords =
    state === "done"
      ? say(doneKey, { count: signals, date: formatDate(finished, locale) })
      : say(`reportFace.peer.${state}`);
  const peer = (name: string, words: string, testId: string, body: React.ReactNode) => (
    <li key={testId} data-testid={testId} className="rounded-lg border border-border-default bg-surface-1 p-3">
      {body ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-fg">{name}</span>
            <span className="text-fg-secondary">{words}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-3">{body}</div>
        </details>
      ) : (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold text-fg">{name}</span>
          <span className="text-fg-secondary">{words}</span>
        </div>
      )}
    </li>
  );
  return (
    <section aria-labelledby="other-checks" className="flex flex-col gap-2" data-testid="other-checks">
      <h2 id="other-checks" className="font-display text-lg font-bold text-fg">
        {say("reportFace.otherChecks")}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {peer(
          say("reportFace.peer.authenticity"),
          authenticityWords,
          "peer-authenticity",
          traces ? <AuthenticitySignals report={traces} runId={authenticity?.runId} answers={answers} /> : null,
        )}
        {registry
          ? peer(
              say("reportFace.peer.registry"),
              say("reportFace.peer.consulted", { date: formatDate(registry.consultedAt, locale) }),
              "peer-registry",
              <RegistryChecks report={registry} />,
            )
          : null}
      </ul>
    </section>
  );
}
