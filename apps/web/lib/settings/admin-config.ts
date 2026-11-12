import { GROUP, type Group } from "./registry";

/** The pages of the configuration area: the setting groups, then the panels that are not plain settings (the price catalogue among them, ADR-009). */
export const CONFIG_PAGE = {
  ...GROUP,
  prices: "prices",
  coupons: "coupons",
  invitations: "invitations",
  packs: "packs",
  sovkora: "sovkora",
  organisation: "organisation",
} as const;
export type ConfigPage = (typeof CONFIG_PAGE)[keyof typeof CONFIG_PAGE];
export const CONFIG_PAGES = Object.values(CONFIG_PAGE);
export const isConfigPage = (v: string): v is ConfigPage => (CONFIG_PAGES as readonly string[]).includes(v);

/** Whether a page is a plain list of settings (and so has a scope). */
export const isSettingsGroup = (page: ConfigPage): page is Group => (Object.values(GROUP) as string[]).includes(page);
