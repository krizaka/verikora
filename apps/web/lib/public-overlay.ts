/**
 * The words the public export says differently (krizaka-internal#4148): none in the dev app. The public build swaps this module for
 * `lib/public-build/overlay.ts` (an alias of next.config.public.mjs), so one page file reads one dictionary and each target says what is true of it.
 */
export type Overlay = Readonly<Record<string, unknown>>;
export const publicOverlay: { readonly en: Overlay; readonly fr: Overlay } = { en: {}, fr: {} };
