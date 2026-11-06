"use client";

import { krizakaFetch, useMutation, useQuery, useQueryClient } from "@krizaka/query";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { Input, Textarea } from "@krizaka/ui/field";
import { List } from "@krizaka/ui/list";
import { RadioGroup } from "@krizaka/ui/radio-group";
import { useState } from "react";
import { z } from "zod";

import { errorKey } from "@/lib/client";
import { useSay } from "@/lib/i18n-client";
import { SHARE_DEFAULT_DAYS, SHARE_MAX_DAYS } from "@/lib/owner-report";

import { useFileFacts } from "./FilesView";

/** The expiries offered: the default first, the maximum last (the server enforces the same bounds). */
export const SHARE_CHOICES = [SHARE_DEFAULT_DAYS, 14, SHARE_MAX_DAYS] as const;

const shares = z.object({
  shares: z.array(
    z.object({
      id: z.string(),
      recipient: z.string(),
      state: z.enum(["live", "expired", "revoked"]),
      createdAt: z.string(),
      expiresAt: z.string(),
      emailedTo: z.string().nullable(),
      views: z.number(),
    }),
  ),
});
const LANGS = ["en", "fr"] as const;
const sent = z.object({ sentTo: z.string() });
const created = z.object({ id: z.string(), token: z.string(), expiresAt: z.string() });

/** The owner link of a file's report (verikora#128): create it with an expiry, copy it, see the active links with their views, revoke one. */
export function OwnerShare({ fileId, origin }: Readonly<{ fileId: string; origin?: string }>) {
  const { say, locale } = useSay();
  const facts = useFileFacts();
  const client = useQueryClient();
  const base = `/api/applications/${fileId}/report-shares`;
  const key = ["owner-shares", fileId];
  const [days, setDays] = useState<number>(SHARE_DEFAULT_DAYS);
  const [link, setLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // @ephemeral: the e-mail form of the link just created (address, note, the owner's language), not a view of the page
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [lang, setLang] = useState<(typeof LANGS)[number]>(LANGS.find((l) => l === locale) ?? "en");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const list = useQuery({ queryKey: key, queryFn: () => krizakaFetch(base, { schema: shares }) });
  const create = useMutation({
    mutationFn: () => krizakaFetch(base, { method: "POST", json: { days }, schema: created }),
  });
  const mail = useMutation({
    mutationFn: () =>
      krizakaFetch(`${base}/send`, {
        method: "POST",
        json: { token, email: to, locale: lang, ...(note.trim() ? { message: note.trim() } : {}) },
        schema: sent,
      }),
  });
  const revoke = useMutation({
    mutationFn: (shareId: string) => krizakaFetch(base, { method: "DELETE", json: { shareId } }),
  });
  const fail = (error: unknown) => setProblem(say(`errors.${errorKey(error)}`));
  const make = async () => {
    setProblem(null);
    setCopied(false);
    setSentTo(null);
    try {
      const made = await create.mutateAsync();
      setToken(made.token);
      setLink(`${origin ?? window.location.origin}/${locale}/rapport/${made.token}`);
      await client.invalidateQueries({ queryKey: key });
    } catch (error) {
      fail(error);
    }
  };
  const send = async () => {
    setProblem(null);
    setSentTo(null);
    try {
      const done = await mail.mutateAsync();
      setSentTo(done.sentTo);
      setTo("");
      await client.invalidateQueries({ queryKey: key });
    } catch (error) {
      fail(error);
    }
  };
  const remove = async (shareId: string) => {
    setProblem(null);
    try {
      await revoke.mutateAsync(shareId);
      await client.invalidateQueries({ queryKey: key });
    } catch (error) {
      fail(error);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const live = (list.data?.shares ?? []).filter((s) => s.state === "live");
  return (
    <section aria-labelledby="owner-share-title" className="flex flex-col gap-3" data-testid="owner-share">
      <h2 id="owner-share-title" className="m-0 text-lg font-bold text-fg">
        {say("dossiers.share.title")}
      </h2>
      <p className="m-0 text-sm text-fg-secondary">{say("dossiers.share.lead")}</p>
      {/* @ephemeral: the expiry of the link about to be created, a form choice, not a view of the page */}
      <RadioGroup.Root
        variant="segmented"
        label={say("dossiers.share.expiry")}
        value={String(days)}
        onValueChange={(v: string) => setDays(Number(v))}
      >
        {SHARE_CHOICES.map((d) => (
          <RadioGroup.Segment key={d} value={String(d)}>
            {say("dossiers.share.days", { count: d })}
          </RadioGroup.Segment>
        ))}
      </RadioGroup.Root>
      <div>
        <Button variant="secondary" size="md" onClick={() => void make()} disabled={create.isPending}>
          {say(create.isPending ? "dossiers.share.creating" : "dossiers.share.create")}
        </Button>
      </div>
      {problem ? <Alert tone="danger">{problem}</Alert> : null}
      {link ? (
        <div className="flex flex-col gap-2" data-testid="owner-share-link">
          <output className="m-0 block text-sm text-fg-secondary">{say("dossiers.share.created")}</output>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              aria-label={say("dossiers.share.linkLabel")}
              value={link}
              className="min-w-0 flex-1"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button variant="secondary" size="md" onClick={() => void copy()}>
              {say(copied ? "dossiers.share.copied" : "dossiers.share.copy")}
            </Button>
          </div>
          <div className="flex flex-col gap-2" data-testid="owner-share-email">
            <h3 className="m-0 text-base font-bold text-fg">{say("dossiers.share.email.title")}</h3>
            <Input
              type="email"
              autoComplete="off"
              aria-label={say("dossiers.share.email.address")}
              placeholder={say("dossiers.share.email.address")}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <Textarea
              maxLength={500}
              rows={2}
              aria-label={say("dossiers.share.email.message")}
              placeholder={say("dossiers.share.email.message")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {/* @ephemeral: the language of the e-mail about to be sent, a form choice */}
            <RadioGroup.Root
              variant="segmented"
              label={say("dossiers.share.email.language")}
              value={lang}
              onValueChange={(v: string) => setLang(LANGS.find((l) => l === v) ?? "en")}
            >
              <RadioGroup.Segment value="en">English</RadioGroup.Segment>
              <RadioGroup.Segment value="fr">Français</RadioGroup.Segment>
            </RadioGroup.Root>
            <p className="m-0 text-sm text-fg-secondary">{say("dossiers.share.email.hint")}</p>
            <div>
              <Button variant="secondary" size="md" onClick={() => void send()} disabled={mail.isPending || !to.trim()}>
                {say(mail.isPending ? "dossiers.share.email.sending" : "dossiers.share.email.send")}
              </Button>
            </div>
            {sentTo ? (
              <output className="m-0 block text-sm text-fg-secondary">
                {say("dossiers.share.email.sent", { email: sentTo })}
              </output>
            ) : null}
          </div>
        </div>
      ) : null}
      <h3 className="m-0 text-base font-bold text-fg">{say("dossiers.share.active")}</h3>
      {list.isPending ? (
        <p className="m-0 text-sm text-fg-secondary">{say("dossiers.share.loading")}</p>
      ) : live.length ? (
        <List
          aria-label={say("dossiers.share.active")}
          items={live}
          getId={(s) => s.id}
          row={(s) => ({
            title: say("dossiers.share.expires", { date: facts.date(s.expiresAt) }),
            description: (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="success">{say("dossiers.share.state.live")}</Badge>
                {s.emailedTo ? <span>{say("dossiers.share.email.sentTo", { email: s.emailedTo })}</span> : null}
                <span>
                  {say(s.views === 1 ? "dossiers.share.viewsOne" : "dossiers.share.views", { count: s.views })}
                </span>
              </span>
            ),
            actions: (
              <Button variant="ghost" size="sm" onClick={() => void remove(s.id)} disabled={revoke.isPending}>
                {say("dossiers.share.revoke")}
              </Button>
            ),
          })}
        />
      ) : (
        <p className="m-0 text-sm text-fg-secondary">{say("dossiers.share.none")}</p>
      )}
    </section>
  );
}
