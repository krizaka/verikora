import type { Overlay } from "@/lib/public-overlay";
import publicEn from "@/messages/public/en.json";
import publicFr from "@/messages/public/fr.json";

/**
 * What the public export says differently from the dev app (krizaka-internal#4148): a site with no account and no document. The privacy
 * notice is replaced as a whole; the docs change only the entries below (the API section is dropped by `docsSections`, not by words).
 */
export const publicOverlay: { readonly en: Overlay; readonly fr: Overlay } = { en: publicEn, fr: publicFr };
