import { CodeBlock } from "@krizaka/ui/code-block";

import { VERIKORA_API_KEY_RULES } from "@/lib/api-keys";
import { ERROR_BODY_CODE, quickstartCode, WEBHOOK_SIGNATURE_CODE } from "@/lib/docs";
import { type ApiAnswer, type ApiOperation, apiOperations, apiWebhooks, OPENAPI_PATH } from "@/lib/docs-api";
import { format, getDictionary, type Locale } from "@/lib/i18n";
import { SITE_URL } from "@/lib/site";

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
 * The API section of /docs, read from the OpenAPI document (verikora#387). Its own file so the public export, which has no API,
 * leaves it out (`docsSections()`): this section is only rendered when the build lists it.
 */
export function ApiSection({ locale }: Readonly<{ locale: Locale }>) {
  const d = getDictionary(locale).docs;
  const operations = apiOperations();
  // An answer several routes share is said once under the table, never repeated on each route.
  const commonAnswers = sharedAnswers(operations);
  const rules = VERIKORA_API_KEY_RULES;
  return (
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
      <WebhooksPart locale={locale} />
    </DocSection>
  );
}

/** The webhooks an account may receive, and how to check their signature. */
function WebhooksPart({ locale }: Readonly<{ locale: Locale }>) {
  const d = getDictionary(locale).docs;
  const webhooks = apiWebhooks();
  return (
    <>
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
    </>
  );
}
