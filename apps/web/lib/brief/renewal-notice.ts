import { formatDate, formatMoney } from "@krizaka/intl";

import { format, getDictionary, type Locale } from "../i18n";
import { addDays, formatDay, parseDay } from "./calendar";
import type { NoticeWindow } from "./renewal-radar";

/**
 * The notice of renewal with a rent increase (verikora#228): the document the manager reads, signs and sends — Verikora never
 * sends it on their behalf. Plain lines from the messages; the rent proposed is the manager's (blank when the TAL's figures are
 * not entered). Informative, not legal advice.
 */
export interface NoticeInput {
  door: string;
  endDay: string;
  rentCents: number;
  /** The rent proposed, in cents; null leaves a blank to fill by hand. */
  newRentCents: number | null;
  window: Pick<NoticeWindow, "opens" | "closes"> & { citation: string };
}

export interface Notice {
  title: string;
  lines: string[];
  /** The whole notice as plain text, one line per paragraph. */
  text: string;
}

/** The notice is a Canadian document: dates and money the way Québec writes them. */
const TAG = { en: "en-CA", fr: "fr-CA" } as const;

export function renewalNotice(input: NoticeInput, locale: Locale): Notice {
  const words = getDictionary(locale).brief.renewalNotice;
  const tag = TAG[locale];
  const day = (text: string) => formatDate(`${text}T12:00:00Z`, { locale: tag, style: "long", timeZone: "UTC" });
  const end = parseDay(input.endDay);
  const effective = day(end ? formatDay(addDays(end, 1)) : input.endDay);
  const money = (cents: number) => formatMoney(cents, { currency: "CAD", locale: tag });
  const lines = [
    format(words.door, { door: input.door }),
    format(words.end, { end: day(input.endDay) }),
    format(words.current, { rent: money(input.rentCents) }),
    input.newRentCents === null
      ? format(words.proposedBlank, { effective })
      : format(words.proposed, { rent: money(input.newRentCents), effective }),
    words.refusal,
    format(words.window, {
      opens: day(input.window.opens),
      closes: day(input.window.closes),
      citation: input.window.citation,
    }),
    words.signature,
    words.disclaimer,
  ];
  return { title: words.title, lines, text: [words.title, "", ...lines].join("\n") };
}
