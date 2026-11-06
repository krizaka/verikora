import { BRAND_ID } from "./brand";

/** The mark is the brand export of @krizaka/ui (generated from the code, on the media CDN), never a shape drawn here (#575: the card drew a gradient rectangle). */
export const MARK_URL = `${process.env.NEXT_PUBLIC_MEDIA_CDN_URL ?? "https://krizaka-assets.b-cdn.net"}/brand/${BRAND_ID}/logo-dark.svg`;

/** The mark as a data address the card can draw; fails the build when the CDN does not answer (a card without its mark is not shipped). */
export async function markDataUri(fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(MARK_URL);
  if (!res.ok) throw new Error(`og.png: the Verikora mark answered ${res.status}`);
  return `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}
