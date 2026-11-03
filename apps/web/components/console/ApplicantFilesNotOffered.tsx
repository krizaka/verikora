import { EmptyState } from "@krizaka/ui/empty-state";
import { PageHeader } from "@krizaka/ui/page-header";

import { ButtonLink } from "@/components/ButtonLink";
import { CONSOLE_ROUTES } from "@/lib/console-nav";
import { asLocale, getDictionary } from "@/lib/i18n";

/**
 * What « Dossiers » and the screening say to a person who is not offered the applicant files (krizaka-internal#2289): which side the
 * page is for, and the way to the setting that changes it — never a 404, a page that exists is a page that explains. No bird.
 */
export function ApplicantFilesNotOffered({ locale }: Readonly<{ locale: string }>) {
  const lang = asLocale(locale);
  const t = getDictionary(lang).console.dossiers;
  return (
    <div className="flex flex-col gap-6" data-testid="files-not-offered">
      <PageHeader title={t.title} />
      <EmptyState
        title={t.notOffered.title}
        description={t.notOffered.text}
        action={
          <ButtonLink href={`/${lang}${CONSOLE_ROUTES.account}/profil`} variant="secondary" size="md">
            {t.notOffered.action}
          </ButtonLink>
        }
      />
    </div>
  );
}
