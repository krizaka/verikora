/**
 * Showcase mode (verikora#1968): the build that is filmed for the download page (`EXPO_PUBLIC_APP_SHOWCASE=1`, set by the
 * download-videos workflow only) wears no development notice. The stage it follows is unchanged; only the notice is not drawn.
 */
export const isShowcase = (value: string | undefined): boolean => value === "1";

/** The stage the development notice is drawn for: `prod` (nothing) in showcase mode, the build's own stage otherwise. */
export const noticeStage = (stage: string, showcase: boolean): string => (showcase ? "prod" : stage);
