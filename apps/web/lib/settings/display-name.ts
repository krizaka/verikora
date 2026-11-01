import { DISPLAY_NAME_KEY } from "@krizaka/settings";

import { PRODUCT_NAME, productName } from "../brand";
import { appSettings } from "./instance";

/**
 * The name to show right now (krizaka-internal#2038): the administrator's `brand.displayName`, else the commercial name.
 * A settings store that cannot answer never blocks a mail or a PDF: the commercial name is the safe default.
 */
export async function currentProductName(): Promise<string> {
  try {
    return productName(await appSettings().get(DISPLAY_NAME_KEY));
  } catch {
    return PRODUCT_NAME;
  }
}
