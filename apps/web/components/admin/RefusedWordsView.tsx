"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Button } from "@krizaka/ui/button";
import { createKrizakaForm } from "@krizaka/ui/form";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { formI18n } from "@/lib/form-i18n";
import { useSay } from "@/lib/i18n-client";
import { REFUSED_LANGUAGES, type RefusedLanguage, type RefusedWords } from "@/lib/report-contract";

const KEY = ["admin-refused-words"];
const list = z.object({ fr: z.array(z.string()), en: z.array(z.string()) });

const addForm = createKrizakaForm({
  schema: z.object({ language: z.enum(REFUSED_LANGUAGES), word: z.string().trim().min(2).max(40) }),
  defaultValues: { language: "fr" as RefusedLanguage, word: "" },
});

/**
 * The words a report may never use (krizaka-internal#3378), one list per language: add a word or a short phrase, remove one (the last of a
 * language stays). The bounds are the server's; every change is on the audit trail.
 */
export function RefusedWordsView() {
  const { say } = useSay();
  const data = useQuery({ queryKey: KEY, queryFn: () => krizakaFetch("/api/admin/refused-words", { schema: list }) });
  if (!data.data) {
    return null;
  }
  return (
    <div className="flex flex-col gap-8" data-testid="refused-words">
      <p className="m-0 max-w-[70ch] text-sm text-fg-secondary">{say("adminConfig.words.lead")}</p>
      <AddWord />
      {REFUSED_LANGUAGES.map((language) => (
        <WordList key={language} language={language} words={data.data[language]} />
      ))}
    </div>
  );
}

function AddWord() {
  const { say, locale } = useSay();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const form = addForm.useForm({
    ...formI18n(say, locale),
    defaultValues: { language: locale, word: "" },
    onSubmit: async (values) => {
      setProblem(null);
      setAdded(null);
      try {
        const done = await krizakaFetch("/api/admin/refused-words", {
          method: "POST",
          json: { language: values.language, word: values.word },
          schema: z.object({ word: z.string() }),
        });
        setAdded(done.word);
      } catch (error) {
        setProblem(say(`errors.${errorKey(error)}`));
        throw error;
      }
      form.reset();
      await client.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <section aria-labelledby="refused-add-title" className="flex max-w-xl flex-col gap-3" data-testid="refused-add">
      <h2 id="refused-add-title" className="m-0 font-display text-lg font-bold text-fg">
        {say("adminConfig.words.add")}
      </h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {added ? <Alert tone="success">{say("adminConfig.words.added", { word: added })}</Alert> : null}
      <form.Form aria-label={say("adminConfig.words.add")} className="flex flex-col gap-4">
        <form.Select
          name="language"
          label={say("adminConfig.words.language")}
          options={REFUSED_LANGUAGES.map((l) => ({ value: l, label: say(`adminConfig.words.languages.${l}`) }))}
        />
        <form.TextField
          name="word"
          label={say("adminConfig.words.word")}
          hint={say("adminConfig.words.wordHint")}
          autoComplete="off"
        />
        <div>
          <form.Submit size="md">{say("adminConfig.words.submit")}</form.Submit>
        </div>
      </form.Form>
    </section>
  );
}

function WordList({ language, words }: Readonly<{ language: RefusedLanguage; words: RefusedWords[RefusedLanguage] }>) {
  const { say } = useSay();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (word: string) =>
      krizakaFetch("/api/admin/refused-words", { method: "DELETE", json: { language, word } }),
    onSuccess: () => {
      setProblem(null);
      return client.invalidateQueries({ queryKey: KEY });
    },
    onError: (error) => setProblem(say(`errors.${errorKey(error)}`)),
  });
  const title = say(`adminConfig.words.listTitle.${language}`);
  return (
    <section
      aria-labelledby={`refused-${language}`}
      className="flex flex-col gap-2"
      data-testid={`refused-${language}`}
    >
      <h2 id={`refused-${language}`} className="m-0 font-display text-lg font-bold text-fg">
        {title}
      </h2>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {words.map((word) => (
          <li key={word} className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
            <span className="break-words text-sm text-fg">{word}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={remove.isPending}
              aria-label={say("adminConfig.words.removeWord", {
                word,
                language: say(`adminConfig.words.languages.${language}`),
              })}
              onClick={() => remove.mutate(word)}
            >
              {say("adminConfig.words.remove")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
