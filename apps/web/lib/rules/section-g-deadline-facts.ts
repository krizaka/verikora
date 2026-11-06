import type { ReportFact } from "@verikora/core";

import type { SectionGDeadlineInput } from "./section-g-deadline";

type Facts = Readonly<Record<string, ReportFact>> | undefined;

const dateOf = (fact: ReportFact | undefined): string | null => (fact && "date" in fact ? fact.date : null);

/**
 * The deadline's input from the figures the lease ruleset exposes (`facts`): `concludedOn` and `startsOn` (dates), `noticeGiven` (yes/no, the
 * landlord's notice of art. 1895). Nothing is guessed: a date or the yes/no that is not found gives no deadline. The day counted from is the
 * report's own (`asOf`), the day the lease was read. A notice with a false statement needs the day it was learned, which a lease does not say: not read here.
 */
export function deadlineInputFromFacts(facts: Facts, asOf: string): SectionGDeadlineInput | null {
  const concludedOn = dateOf(facts?.concludedOn);
  const startsOn = dateOf(facts?.startsOn);
  const given = facts?.noticeGiven;
  if (!concludedOn || !startsOn || !given || !("flag" in given) || !/^\d{4}-\d{2}-\d{2}/.test(asOf)) return null;
  return {
    concludedOn,
    startsOn,
    notice: given.flag ? { kind: "given" } : { kind: "not-given" },
    today: asOf.slice(0, 10),
  };
}
