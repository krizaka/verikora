"use client";

import { Field, Input } from "@krizaka/ui/field";
import { useState } from "react";

import { useSay } from "@/lib/i18n-client";
import { AFFORDABILITY_RULE, checkAffordability } from "@/lib/rules/affordability";

/** The sentences of `affordability.*` (the rule's own messages, EN/FR), passed by the page: the console's client slice does not carry them. */
export type RentShareWords = Readonly<Record<"share" | "no-claim" | "note" | "disclaimer", string>>;

const TAG = { en: "en-CA", fr: "fr-CA" } as const;

/** « 1 250,50 » or « 1250.5 » to integer cents; nothing usable gives `undefined` (the rule then makes no claim). */
export function centsOf(text: string): number | undefined {
  const cleaned = text.replace(/[\s$]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : undefined;
}

/** What the two figures give, as the sentences to show: the share (or the « no figure » line), then the note and the disclaimer. Pure. */
export function rentShareSentences(
  rent: string,
  income: string,
  locale: "en" | "fr",
  words: RentShareWords,
): string[] | null {
  if (!rent.trim() && !income.trim()) return null;
  const result = checkAffordability({ rentCents: centsOf(rent) ?? 0, monthlyIncomeCents: centsOf(income) });
  const share =
    result.code === "share"
      ? new Intl.NumberFormat(TAG[locale], { style: "percent", maximumFractionDigits: 1 }).format(
          result.figures.shareBasisPoints / 10_000,
        )
      : "";
  const head = result.code === "share" ? words.share.replace("{share}", share) : words["no-claim"];
  return [head, words.note, words.disclaimer];
}

/**
 * The rent as a share of an income the applicant gave (verikora#104, TS-A-001): INFORMATION for the landlord on the applicant's file, never
 * a verdict, score or threshold (guardrail verikora#557/#559). The two figures are typed here and used in memory: nothing is sent or kept.
 */
export function RentShare({ words }: Readonly<{ words: RentShareWords }>) {
  const { say, locale } = useSay();
  // @ephemeral: the two figures typed to see the share; used in memory, never sent or kept
  const [rent, setRent] = useState("");
  const [income, setIncome] = useState("");
  const sentences = rentShareSentences(rent, income, locale, words);
  return (
    <section
      aria-labelledby="rent-share-title"
      className="flex flex-col gap-3"
      data-testid="rent-share"
      data-rule={AFFORDABILITY_RULE.id}
    >
      <h2 id="rent-share-title" className="m-0 text-lg font-bold text-fg">
        {say("dossiers.rentShare.title")}
      </h2>
      <p className="m-0 text-sm text-fg-secondary">{say("dossiers.rentShare.lead")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field.Root>
          <Field.Label htmlFor="rent-share-rent">{say("dossiers.rentShare.rent")}</Field.Label>
          <Input
            id="rent-share-rent"
            inputMode="decimal"
            autoComplete="off"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label htmlFor="rent-share-income">{say("dossiers.rentShare.income")}</Field.Label>
          <Input
            id="rent-share-income"
            inputMode="decimal"
            autoComplete="off"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
          />
        </Field.Root>
      </div>
      <div aria-live="polite" data-testid="rent-share-result" className="flex flex-col gap-2 text-sm text-fg-secondary">
        {sentences?.map((s) => (
          <p key={s} className="m-0">
            {s}
          </p>
        ))}
      </div>
    </section>
  );
}
