import { ApiError } from "@krizaka/app-client";
import { Alert } from "@krizaka/ui/alert";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useState } from "react";
import { z } from "zod";

import { useI18n } from "../i18n";
import { verikora } from "../lib/config";

const form = createKrizakaForm({
  schema: z.object({ email: z.string().trim().email(), password: z.string().min(1) }),
  defaultValues: { email: "", password: "" },
});

/** A wrong address or password answers 400 or 401; anything else is the network or the server. */
const REFUSALS = new Set([400, 401]);

export function SignIn() {
  const { t, locale } = useI18n();
  const [problem, setProblem] = useState<string | null>(null);
  const f = form.useForm({
    i18n: { t: () => t("signIn.wrong"), locale },
    onSubmit: async ({ email, password }) => {
      setProblem(null);
      try {
        await verikora.signIn(email, password);
      } catch (error) {
        setProblem(error instanceof ApiError && REFUSALS.has(error.status) ? t("signIn.wrong") : t("common.offline"));
      }
    },
  });
  return (
    <main className="mx-auto flex h-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("signIn.title")}</h1>
        <p className="text-fg-secondary">{t("signIn.lead")}</p>
      </div>
      <f.Form aria-label={t("signIn.title")} className="flex flex-col gap-4">
        <f.TextField name="email" label={t("signIn.email")} autoComplete="username" />
        <f.TextField name="password" type="password" label={t("signIn.password")} autoComplete="current-password" />
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <f.Submit>{t("signIn.submit")}</f.Submit>
      </f.Form>
      <p className="text-sm text-fg-secondary">{t("signIn.createAccount")}</p>
      <p className="text-xs text-fg-muted">{t("disclaimer")}</p>
    </main>
  );
}
