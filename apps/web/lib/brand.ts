import { brandOf, displayName, lockup } from "@krizaka/org";

/** The product's id in the shared libraries (`@krizaka/org`, `@krizaka/ui`, `@krizaka/email`). Never rendered. */
export const BRAND_ID = "verikora";

/**
 * The name customers read (krizaka-internal#2038): the administrator's `brand.displayName` setting when one is set, else the
 * commercial name of `@krizaka/org`. Surfaces rendered at request time pass the setting; build-time ones use the default.
 */
export const productName = (chosen?: string | null): string => displayName(BRAND_ID, chosen);

/** « Verikora by Krizaka » / « Verikora par Krizaka ». */
export const productLockup = (locale: string, chosen?: string | null): string => lockup(BRAND_ID, locale, chosen);

/** The default display name, for build-time and static surfaces. */
export const PRODUCT_NAME = productName();

/** The analysis engine's commercial name. */
export const ENGINE_NAME = brandOf("sovkora").commercialName;

/** « by Krizaka » / « par Krizaka », for the lockup's second line. */
export const productEndorsement = (locale: string): string => {
  const endorsement: Record<string, string | undefined> = { ...brandOf(BRAND_ID).endorsement };
  return endorsement[locale] ?? endorsement.en ?? "";
};
