"use client";

import { formatDate } from "@krizaka/intl";
import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { Dialog } from "@krizaka/ui/dialog";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { applicantLink, applicantRequest } from "@/lib/applicant-file-face";
import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";

import { DISPLAY_TIME_ZONE, INTL } from "./format";

const request = createKrizakaForm({
  schema: applicantRequest,
  defaultValues: { candidateName: "", candidateEmail: "", types: [] as string[] },
});
const made = z.object({ id: z.string(), token: z.string(), expiresAt: z.string() });

/** A type of the catalogue the form offers, with its words (the applicant's catalogue, `applicantFile.types`). */
export interface AskableType {
  id: string;
  label: string;
}

/**
 * « Demander des documents » (design § 5.2, verikora#323): a dialog with the applicant's name and e-mail and the documents to
 * ask for, among the requestable types only (`requestableTypes`; the schema and the service refuse the others too). The link
 * comes back once and is shown once, to copy; the list follows.
 */
export function RequestDocuments({
  types,
  origin,
  trigger,
}: Readonly<{ types: readonly AskableType[]; origin: string; trigger: React.ReactNode }>) {
  const { say, locale } = useSay();
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: (body: z.infer<typeof applicantRequest>) =>
      krizakaFetch("/api/applications", { method: "POST", json: body, schema: made }),
  });
  const form = request.useForm({
    i18n: { t: (k, vars) => say(k, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        const answer = await create.mutateAsync(values);
        setResult({
          name: values.candidateName,
          link: applicantLink(origin, locale, answer.token),
          expiresAt: answer.expiresAt,
        });
        router.refresh();
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  });
  const onOpenChange = (open: boolean) => {
    if (open) return;
    setResult(null);
    setCopied(false);
    form.reset();
  };
  return (
    <Dialog.Root onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Content closeLabel={say("dossiers.form.close")}>
        <Dialog.Header>
          <Dialog.Title>
            {result ? say("dossiers.made.title", { name: result.name }) : say("dossiers.form.title")}
          </Dialog.Title>
          <Dialog.Description>
            {result
              ? say("dossiers.made.text", {
                  date: formatDate(result.expiresAt, { locale: INTL[locale], timeZone: DISPLAY_TIME_ZONE }),
                })
              : say("dossiers.form.lead")}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {result ? (
            <div className="flex flex-col gap-3" data-testid="request-made">
              <p className="m-0 break-all rounded-lg border border-border-default bg-surface-1 p-3 text-sm text-fg">
                {result.link}
              </p>
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard?.writeText(result.link).then(() => setCopied(true))}
              >
                {copied ? say("dossiers.made.copied") : say("dossiers.made.copy")}
              </Button>
            </div>
          ) : (
            <form.Form aria-label={say("dossiers.form.title")} className="flex flex-col gap-3">
              <form.TextField name="candidateName" label={say("dossiers.form.name")} autoComplete="off" />
              <form.TextField
                name="candidateEmail"
                label={say("dossiers.form.email")}
                type="email"
                autoComplete="off"
              />
              <form.Combobox
                name="types"
                multiple
                label={say("dossiers.form.types")}
                options={types.map((t) => ({ value: t.id, label: t.label }))}
              />
              {problem ? <Alert tone="danger">{problem}</Alert> : null}
              <form.Submit>{say("dossiers.form.submit")}</form.Submit>
            </form.Form>
          )}
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
