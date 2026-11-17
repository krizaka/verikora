import { DocsArticlePage } from "@krizaka/ui/docs-article-page";
import { DocsNav } from "@krizaka/ui/docs-nav";
import Link from "next/link";

import { docsSections } from "@/lib/docs";
import { getDictionary, type Locale } from "@/lib/i18n";
import { pagePath } from "@/lib/site";

import { ApiSection } from "./ApiSection";
import { CheckSection } from "./CheckSection";
import { DocH2, DocSection } from "./DocsParts";

/**
 * The documentation of Verikora, on its own site (verikora#387): how a check works, the API (generated from the OpenAPI
 * document), and the data. On the docs template of @krizaka/ui. Every word is a message; the API reference is read from the
 * OpenAPI document, so nothing the document says is typed here.
 */
export function DocsContent({ locale }: Readonly<{ locale: Locale }>) {
  const t = getDictionary(locale);
  const d = t.docs;
  const home = pagePath(locale, "home");
  const sections = docsSections().map((id) => ({ id, label: d.sections[id] }));
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
      <CheckSection locale={locale} />

      {sections.some((section) => section.id === "api") ? <ApiSection locale={locale} /> : null}

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
