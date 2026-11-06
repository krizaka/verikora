import { CodeBlock } from "@krizaka/ui/code-block";
import { DocsArticlePage } from "@krizaka/ui/docs-article-page";
import { DocsNav } from "@krizaka/ui/docs-nav";
import Link from "next/link";

import { VERIKORA_API_KEY_RULES } from "@/lib/api-keys";
import { DOCS_SECTIONS, ERROR_BODY_CODE, quickstartCode, WEBHOOK_SIGNATURE_CODE } from "@/lib/docs";
import { type ApiAnswer, type ApiOperation, apiOperations, apiWebhooks, OPENAPI_PATH } from "@/lib/docs-api";
import { format, getDictionary, type Locale } from "@/lib/i18n";
import { pagePath, SITE_URL } from "@/lib/site";

import { ApiRoutesTable } from "./ApiRoutesTable";
import { CodesTable } from "./CodesTable";
import { DocH2, DocH3, DocSection } from "./DocsParts";

const answerKey = (a: ApiAnswer) => `${a.status} ${a.description}`;

/** The answers (status and words) that two routes or more give. */
function sharedAnswers(operations: readonly ApiOperation[]): Map<string, ApiAnswer> {
  const seen = new Map<string, { answer: ApiAnswer; count: number }>();
  for (const answer of operations.flatMap((op) => op.answers)) {
    const entry = seen.get(answerKey(answer));
    seen.set(answerKey(answer), { answer, count: (entry?.count ?? 0) + 1 });
  }
  return new Map([...seen].filter(([, v]) => v.count > 1).map(([k, v]) => [k, v.answer]));
}

/**
 * The documentation of Verikora, on its own site (verikora#387): how a check works, the API (generated from the OpenAPI
 * document), and the data. On the docs template of @krizaka/ui. Every word is a message; the API reference is read from the
 * OpenAPI document, so nothing the document says is typed here.
 */
export function DocsContent({ locale }: Readonly<{ locale: Locale }>) {
  const t = getDictionary(locale);
  const d = t.docs;
  const levels = t.console.analysis.levels;
  const operations = apiOperations();
  const webhooks = apiWebhooks();
  // An answer several routes share is said once under the table, never repeated on each route.
  const commonAnswers = sharedAnswers(operations);
  const rules = VERIKORA_API_KEY_RULES;
  const home = pagePath(locale, "home");
  const sections = DOCS_SECTIONS.map((id) => ({ id, label: d.sections[id] }));
  return (
    <DocsArticlePage
      linkAs={Link}
      sidebarLabel={d.sidebarLabel}
      sidebar={
        <DocsNav
          label={d.navLabel}
          linkAs={Link}
          groups={[
            {
              id: "verikora",
              title: t.meta.siteName,
              items: sections.map((s) => ({ href: `#${s.id}`, label: s.label })),
            },
          ]}
        />
      }
      breadcrumbLabel={d.breadcrumbLabel}
      breadcrumb={[
        { href: home, label: t.meta.siteName },
        { href: pagePath(locale, "docs"), label: d.title },
      ]}
      title={d.title}
      lead={d.lead}
      toc={{ label: d.tocLabel, items: sections }}
    >
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

      <DocSection id="api">
        <DocH2>{d.sections.api}</DocH2>
        <p>{format(d.api.intro, { openapi: OPENAPI_PATH })}</p>
        <p>
          <a href={OPENAPI_PATH}>{d.api.openapiLink}</a>
        </p>
        <DocH3>{d.api.accessTitle}</DocH3>
        <p>
          {format(d.api.access, {
            prefix: rules.prefix,
            scopes: rules.scopes.join(", "),
            days: String(rules.maxExpiryDays),
            grace: String(rules.rotationGraceHours),
          })}
        </p>
        <DocH3>{d.api.quickstartTitle}</DocH3>
        <CodeBlock
          className="[&_pre]:break-words [&_pre]:whitespace-pre-wrap"
          code={quickstartCode(SITE_URL)}
          language="bash"
          file="curl"
        />
        <p>{d.api.quickstartNote}</p>
        <DocH3>{d.api.routesTitle}</DocH3>
        <ApiRoutesTable
          operations={operations}
          shared={[...commonAnswers.keys()]}
          labels={{
            caption: d.api.routesTitle,
            route: d.api.route,
            scope: d.api.scope,
            noScope: d.api.noScope,
            answers: d.api.answers,
            parameters: d.api.parameters,
          }}
        />
        <DocH3>{d.api.statusTitle}</DocH3>
        <p>{d.api.statusLead}</p>
        <CodesTable
          rows={[...commonAnswers.values()].map((answer) => ({ code: answer.status, meaning: answer.description }))}
          labels={{ caption: d.api.statusTitle, code: d.api.codeColumn, meaning: d.api.meaningColumn }}
        />
        <DocH3>{d.api.errorsTitle}</DocH3>
        <p>{d.api.errors}</p>
        <CodeBlock
          className="[&_pre]:break-words [&_pre]:whitespace-pre-wrap"
          code={ERROR_BODY_CODE}
          language="json"
          file={d.api.errorShapeLabel}
        />
        <DocH3>{d.api.webhooksTitle}</DocH3>
        <p>{d.api.webhooks}</p>
        <CodesTable
          rows={webhooks.map((hook) => ({ code: hook.event, meaning: hook.summary }))}
          labels={{ caption: d.api.webhooksTitle, code: d.api.event, meaning: d.api.meaningColumn }}
        />
        <DocH3>{d.api.signatureTitle}</DocH3>
        <p>{d.api.signature}</p>
        <CodeBlock
          className="[&_pre]:break-words [&_pre]:whitespace-pre-wrap"
          code={WEBHOOK_SIGNATURE_CODE}
          language="bash"
          file={d.api.signatureLabel}
        />
      </DocSection>

      <DocSection id="data">
        <DocH2>{d.sections.data}</DocH2>
        <p>{d.data.intro}</p>
        <p>{d.data.retention}</p>
        <p>{d.data.sovkora}</p>
        <p>
          <Link href={pagePath(locale, "privacy")}>{d.data.privacy}</Link>
        </p>
      </DocSection>
    </DocsArticlePage>
  );
}
