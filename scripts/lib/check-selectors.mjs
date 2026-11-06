// The test ids the landing take clicks, in one place. `check-selectors.test.mjs` proves each one is still drawn by its
// component, so a UI change that would break the take fails a test first (the take is not a second guess of the UI).
export const CHECK_TEST_IDS = {
  defaults: { id: "check-defaults", source: "apps/web/components/console/DocumentUploader.tsx" },
  keep: { id: "keep-choice", source: "apps/web/components/console/DocumentUploader.tsx" },
  kind: { id: "kind-choice", source: "apps/web/components/console/CheckView.tsx" },
  runId: { id: "sovkora-run-id", source: "apps/web/components/console/ReportFace.tsx" },
};

/** The CSS selector of a test id. */
export const byTestId = (key) => `[data-testid="${CHECK_TEST_IDS[key].id}"]`;
