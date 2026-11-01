import { brandOf, displayName, lockup } from "@krizaka/org";

/** The internal name of this product: the repository, the packages, the CLI. Never rendered. */
export const CODE_NAME = "yomizaka";

/**
 * The name customers read (krizaka-internal#2038): the administrator's `brand.displayName` setting when one is set, else the
 * commercial name of `@krizaka/org`. Surfaces rendered at request time pass the setting; build-time ones use the default.
 */
export const productName = (chosen?: string | null): string => displayName(CODE_NAME, chosen);

/** « Verikora by Krizaka » / « Verikora par Krizaka ». */
export const productLockup = (locale: string, chosen?: string | null): string => lockup(CODE_NAME, locale, chosen);

/** The default display name, for build-time and static surfaces. */
export const PRODUCT_NAME = productName();

/** The analysis engine's commercial name (code name `orazaka`). */
export const ENGINE_NAME = brandOf("orazaka").commercialName;
