/**
 * The 44 px touch targets of the @krizaka/ui controls the package draws smaller (krizaka-internal#3972): the row expand button of
 * a table (28 px) and the « Choose files » button of a drop area (36 px). Classes for the component's `className`.
 */
export const EXPAND_BUTTON_TARGET = "[&_button[aria-expanded]]:min-h-11 [&_button[aria-expanded]]:min-w-11";
export const BROWSE_BUTTON_TARGET = "[&_button]:min-h-11";
