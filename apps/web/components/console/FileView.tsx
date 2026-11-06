"use client";

import type { StatusSet } from "@krizaka/organize/contract";
import { Badge } from "@krizaka/ui/badge";
import { DetailLayout } from "@krizaka/ui/detail-layout";
import { List } from "@krizaka/ui/list";
import Link from "next/link";

import type { ApplicantFileView, FileDocumentView } from "@/lib/applicant-file";
import { checkFact } from "@/lib/applicant-file-face";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { useSay } from "@/lib/i18n-client";
import { pluralKey } from "@/lib/plural";

import { DecisionActions } from "../organise/DecisionActions";
import { FileTags } from "../organise/FileTags";
import { useFileFacts } from "./FilesView";
import { OwnerShare } from "./OwnerShare";
import { RentShare, type RentShareWords } from "./RentShare";
import type { AskableType } from "./RequestDocuments";

/** One line of the file: a document asked, with the one received for it (or none yet). */
interface AskedRow {
  id: string;
  type: string;
  document: FileDocumentView | null;
}

/** The documents asked, in the request's order, each with what came in for it; a type asked twice in is two rows. */
export function askedRows(file: Pick<ApplicantFileView, "requestedTypes" | "documents">): AskedRow[] {
  return file.requestedTypes.flatMap((type): AskedRow[] => {
    const received = file.documents.filter((d) => d.typeId === type);
    return received.length
      ? received.map((d) => ({ id: d.id, type, document: d }))
      : [{ id: `asked-${type}`, type, document: null }];
  });
}

/**
 * One applicant file (design § 4, verikora#323): the applicant, the link's state, the day it was asked, then the documents
 * asked — each with the one received, what becomes of it, and its checks as Sovkora returned them, leading to its report (the
 * run ids are there). With the organised workspace (verikora#324): your decision and its actions, then the tags.
 */
export function FileView({
  file,
  types,
  workspace,
  affordability,
}: Readonly<{
  file: ApplicantFileView;
  types: readonly AskableType[];
  /** The sentences of the rent-share rule; absent, the section is not shown. */
  affordability?: RentShareWords;
  workspace?: {
    set: StatusSet;
    decision: string;
    tags: readonly { id: string; name: string; color: "blue" | "green" | "amber" | "red" | "violet" | "gray" }[];
    tagIds: readonly string[];
  };
}>) {
  const { say, locale } = useSay();
  const facts = useFileFacts();
  const label = (type: string) => types.find((t) => t.id === type)?.label ?? type;
  const retention = (d: FileDocumentView) => {
    if (d.purged) return say("dossiers.detail.purged");
    return d.retention === "after-decision" ? say("dossiers.detail.kept") : say("dossiers.detail.afterCheck");
  };
  const checks = (d: FileDocumentView) => (
    <span className="mt-1 flex flex-wrap gap-1">
      {d.checks.map((c) => {
        const fact = checkFact(c);
        const studio = say(`dossiers.studios.${c.studio}`);
        const words = fact.count ? say(pluralKey(fact.key, fact.count), { count: fact.count }) : say(fact.key);
        return (
          <Badge key={c.id} tone={fact.tone}>
            {`${studio} · ${words}`}
          </Badge>
        );
      })}
      {d.skipped.length ? <Badge tone="neutral">{say("dossiers.detail.skipped")}</Badge> : null}
    </span>
  );
  return (
    <DetailLayout
      back={<Link href={`/${locale}${CONSOLE_ROUTES.files}`}>{say("dossiers.detail.back")}</Link>}
      eyebrow={file.candidateEmail}
      title={file.candidateName}
      meta={`${facts.link(file)} · ${facts.documents(file.documents.length, file.requestedTypes.length)} · ${say("dossiers.detail.requestedOn", { date: facts.date(file.createdAt) })}`}
    >
      {workspace ? <DecisionActions fileId={file.id} state={workspace.decision} set={workspace.set} /> : null}
      {workspace ? <FileTags fileId={file.id} tags={workspace.tags} current={workspace.tagIds} /> : null}
      <section aria-labelledby="asked-title" className="flex flex-col gap-3" data-testid="file-asked">
        <h2 id="asked-title" className="m-0 text-lg font-bold text-fg">
          {say("dossiers.detail.asked")}
        </h2>
        <List
          aria-label={say("dossiers.detail.asked")}
          items={askedRows(file)}
          getId={(r) => r.id}
          chevrons
          row={(r) =>
            r.document
              ? {
                  title: label(r.type),
                  description: (
                    <span className="flex flex-col">
                      <span className="[overflow-wrap:anywhere]">{`${say("dossiers.detail.received", { file: r.document.filename })} · ${retention(r.document)}`}</span>
                      {checks(r.document)}
                    </span>
                  ),
                  href: `/${locale}/app/documents/${r.document.id}/rapport`,
                }
              : {
                  title: label(r.type),
                  description: say("dossiers.detail.notReceived"),
                }
          }
        />
      </section>
      {affordability ? <RentShare words={affordability} /> : null}
      <OwnerShare fileId={file.id} />
    </DetailLayout>
  );
}
