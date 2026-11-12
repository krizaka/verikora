"use client";

import { krizakaFetch, useMutation } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { createKrizakaForm } from "@krizaka/ui/form";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

const signUp = createKrizakaForm({
  schema: z.object({
    email: z.string().trim().min(1).email(),
    password: z.string().min(PASSWORD_MIN_LENGTH),
    pilotCode: z.string().trim().max(80),
    acceptTerms: z.boolean().refine((v) => v, "required"),
    acceptPrivacy: z.boolean().refine((v) => v, "required"),
  }),
  defaultValues: { email: "", password: "", pilotCode: "", acceptTerms: false, acceptPrivacy: false },
});

/** E-mail, password and the two consents (terms, privacy notice — Loi 25) on @krizaka/ui's form; the server mails the link. */
export function SignUpForm() {
  const { say, locale } = useSay();
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const request = useMutation({
    mutationFn: (body: {
      email: string;
      password: string;
      pilotCode?: string;
      locale: string;
      acceptTerms: true;
      acceptPrivacy: true;
    }) => krizakaFetch("/api/auth/sign-up", { method: "POST", json: body }),
  });
  const form = signUp.useForm({
    i18n: { t: (key, vars) => say(key, vars as Record<string, string | number> | undefined), locale },
    onSubmit: async (values) => {
      setProblem(null);
      try {
        await request.mutateAsync({
          email: values.email,
          password: values.password,
          ...(values.pilotCode.trim() ? { pilotCode: values.pilotCode.trim() } : {}),
          locale,
          acceptTerms: true,
          acceptPrivacy: true,
        });
        setSent(true);
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
      }
    },
  });
  if (sent)
    return (
      <Alert tone="success" title={say("signUp.sentTitle")}>
        {say("signUp.sent")}
      </Alert>
    );
  const terms = (
    <Link className="underline" href={`/${locale}/terms`} target="_blank">
      {say("signUp.termsLink")}
    </Link>
  );
  const privacy = (
    <Link className="underline" href={`/${locale}/privacy`} target="_blank">
      {say("signUp.privacyLink")}
    </Link>
  );
  const words = (key: string, a: string, link: React.ReactNode) => {
    const [before, after] = say(key, { [a]: "\u0000" }).split("\u0000");
    return (
      <>
        {before}
        {link}
        {after}
      </>
    );
  };
  return (
    <form.Form aria-label={say("signUp.title")} className="flex flex-col gap-4">
      <form.TextField name="email" label={say("signUp.email")} type="email" autoComplete="email" />
      <form.TextField name="password" label={say("signUp.password")} type="password" autoComplete="new-password" />
      <form.TextField
        name="pilotCode"
        label={say("signUp.pilotCode")}
        hint={say("signUp.pilotCodeHint")}
        autoComplete="off"
      />
      <form.Checkbox name="acceptTerms" label={words("signUp.acceptTerms", "terms", terms)} />
      <form.Checkbox name="acceptPrivacy" label={words("signUp.acceptPrivacy", "privacy", privacy)} />
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <form.Submit size="lg" shimmer className="w-full">
        {say("signUp.submit")}
      </form.Submit>
      <p className="text-sm text-fg-secondary">{say("signUp.notice")}</p>
    </form.Form>
  );
}
