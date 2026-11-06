import { rateLimitSettings } from "@krizaka/rate-limit/settings";

/**
 * The limits of the API's actions, as they were hard-coded at each call site (verikora#260): per address, per subject (an account or an
 * address) and the window. They are the DEFAULTS of the settings `limits.<action>.perIp|perSubject|windowSeconds` (the administrator's);
 * `lib/limits.ts` enforces them with `@krizaka/rate-limit`. An action id is letters and digits (it is part of a settings key).
 */
export const LIMIT_DEFAULTS = {
  batchCreate: { perIp: 20, perSubject: 10, windowSeconds: 3600 },
  batchExport: { perIp: 20, perSubject: 10, windowSeconds: 3600 },
  verifyRequest: { perIp: 30, perSubject: 10, windowSeconds: 3600 },
  verify: { perIp: 60, windowSeconds: 600 },
  verifyContract: { perIp: 60, windowSeconds: 60 },
  consent: { perIp: 60, perSubject: 30, windowSeconds: 3600 },
  signUp: { perIp: 5, perSubject: 3, windowSeconds: 3600 },
  verifyEmail: { perIp: 30, windowSeconds: 3600 },
  signIn: { perIp: 30, perSubject: 10, windowSeconds: 900 },
  confirmEmail: { perIp: 30, windowSeconds: 3600 },
  search: { perIp: 600, perSubject: 300, windowSeconds: 3600 },
  perspective: { perIp: 60, perSubject: 30, windowSeconds: 3600 },
  applicantFileRequest: { perIp: 30, perSubject: 20, windowSeconds: 3600 },
  applicantFileAction: { perIp: 60, windowSeconds: 3600 },
  screeningRequest: { perIp: 30, perSubject: 20, windowSeconds: 3600 },
  screeningRespond: { perIp: 60, windowSeconds: 600 },
  upload: { perIp: 120, perSubject: 60, windowSeconds: 3600 },
  analysis: { perIp: 60, perSubject: 30, windowSeconds: 3600 },
  redacted: { perIp: 60, windowSeconds: 3600 },
  reportGrant: { perIp: 60, perSubject: 30, windowSeconds: 3600 },
  reportMail: { perIp: 10, perSubject: 10, windowSeconds: 3600 },
  report: { perIp: 120, perSubject: 60, windowSeconds: 3600 },
  applicant: { perIp: 60, windowSeconds: 600 },
  applicantUpload: { perIp: 60, windowSeconds: 3600 },
  showcaseFile: { perIp: 60, windowSeconds: 3600 },
  showcase: { perIp: 120, windowSeconds: 3600 },
  batchPreview: { perIp: 30, perSubject: 15, windowSeconds: 3600 },
  avatar: { perIp: 60, perSubject: 20, windowSeconds: 3600 },
  portal: { perIp: 30, windowSeconds: 3600 },
  checkout: { perIp: 30, perSubject: 10, windowSeconds: 3600 },
  apiKeyAuth: { perIp: 120, windowSeconds: 60 },
  forgotPassword: { perIp: 10, perSubject: 3, windowSeconds: 3600 },
  resetPassword: { perIp: 20, windowSeconds: 3600 },
  organise: { perIp: 300, perSubject: 120, windowSeconds: 3600 },
  accountRead: { perIp: 1200, perSubject: 600, windowSeconds: 3600 },
  accountWrite: { perIp: 30, perSubject: 15, windowSeconds: 3600 },
} as const;

export type LimitAction = keyof typeof LIMIT_DEFAULTS;

/** The registry fragment (`limits.<action>.*`), spread into `SETTINGS`. */
export const LIMIT_SETTINGS = rateLimitSettings(LIMIT_DEFAULTS);
