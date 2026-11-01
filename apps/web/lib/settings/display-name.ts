import { DISPLAY_NAME_KEY } from "@krizaka/settings";

import { productName } from "../brand";
import { appSettings } from "./instance";

/** The name to show right now (krizaka-internal#2038): the administrator's `brand.displayName`, else the commercial name. */
export async function currentProductName(): Promise<string> {
  return productName(await appSettings().get(DISPLAY_NAME_KEY));
}
