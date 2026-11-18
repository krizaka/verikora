import { redirect } from "next/navigation";

import { requirePageAdmin } from "@/lib/access";
import { asLocale } from "@/lib/i18n";

/** The configuration opens on the general switches; every page of it is a route. */
export default async function ConfigIndex({ params }: { params: Promise<{ locale: string }> }) {
  await requirePageAdmin();
  redirect(`/${asLocale((await params).locale)}/config/general`);
}
