/** The four stages of a pilot code (krizaka-internal#3230), kept apart from the database so the console can read them. */
export const PILOT_STAGE = {
  activated: "activated",
  firstRealFile: "first_real_file",
  firstPayment: "first_payment",
  secondPayment: "second_payment",
} as const;
export type PilotStage = (typeof PILOT_STAGE)[keyof typeof PILOT_STAGE];
export type PilotCounts = Record<PilotStage, number>;

export interface PilotCodeCounts {
  couponId: string;
  code: string;
  counts: PilotCounts;
}
