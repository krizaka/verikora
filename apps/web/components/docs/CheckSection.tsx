import { format, getDictionary, type Locale } from "@/lib/i18n";

import { DocH2, DocH3, DocSection } from "./DocsParts";

/** How a check works: its kinds, a finding, the levels, what Verikora guarantees and what it does not (verikora#387). */
export function CheckSection({ locale }: Readonly<{ locale: Locale }>) {
  const t = getDictionary(locale);
  const d = t.docs;
  const levels = t.console.analysis.levels;
  return (
    <DocSection id="check">
      <DocH2>{d.sections.check}</DocH2>
      <p>{d.check.intro}</p>
      <DocH3>{d.check.kindsTitle}</DocH3>
      <ul className="list-disc space-y-1 pl-6">
        <li>{d.check.compliance}</li>
        <li>{d.check.authenticity}</li>
      </ul>
      <DocH3>{d.check.findingTitle}</DocH3>
      <p>{d.check.finding}</p>
      <DocH3>{d.check.levelsTitle}</DocH3>
      <p>
        {format(d.check.levels, {
          observed: levels["observé"],
          unusual: levels["inhabituel"],
          inconsistent: levels["incohérent"],
        })}
      </p>
      <DocH3>{t.verify.guaranteesTitle}</DocH3>
      <p>{d.check.guaranteesLead}</p>
      <ul className="list-disc space-y-1 pl-6">
        {Object.values(t.verify.guarantees).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <DocH3>{t.verify.limitsTitle}</DocH3>
      <ul className="list-disc space-y-1 pl-6">
        {Object.values(t.verify.limits).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>{d.check.informative}</p>
    </DocSection>
  );
}
