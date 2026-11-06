import { type PhotoOrigin, SIGNAL_LEVELS } from "@verikora/core";
import { differenceInSeconds, parseISO } from "date-fns";

/**
 * What a photo document's origin says, as authenticity signals (verikora#229). A photo's metadata never leaves the intake
 * (ADR-0010): its facts are read at upload, then the metadata is dropped. So the photo is not sent to Sovkora; its kept
 * facts are read here, with the ids and levels of Sovkora's image signals (sovkora-packs `authenticity-signals.json`,
 * IMG-META-*), so a reader meets one vocabulary. Facts, never a verdict; the words are messages (`analysis.photoOrigin.*`).
 */
const [OBSERVED, UNUSUAL, INCONSISTENT] = SIGNAL_LEVELS;

/** A capture and a save within this margin are the same moment (a phone writes both as it saves). */
export const PHOTO_ORIGIN_RULES = { sameMomentSeconds: 60 } as const;

export const ORIGIN_CASE = {
  declared: "declared",
  absent: "absent",
  noDevice: "noDevice",
  modifiedAfter: "modifiedAfter",
  modifiedBefore: "modifiedBefore",
  gpsRemoved: "gpsRemoved",
} as const;
export type OriginCase = (typeof ORIGIN_CASE)[keyof typeof ORIGIN_CASE];

export interface OriginSignal {
  case: OriginCase;
  signalId: string;
  level: (typeof SIGNAL_LEVELS)[number];
  /** The facts the message's `{placeholders}` name. */
  facts: Record<string, string>;
}

const signal = (
  kase: OriginCase,
  signalId: string,
  level: OriginSignal["level"],
  facts: Record<string, string> = {},
): OriginSignal => ({ case: kase, signalId, level, facts });

export function photoOriginSignals(origin: PhotoOrigin | null | undefined, rules = PHOTO_ORIGIN_RULES): OriginSignal[] {
  const { software = null, device = null, takenAt = null, modifiedAt = null, hadGps = false } = origin ?? {};
  const signals: OriginSignal[] = [];
  if (!software && !device && !takenAt && !modifiedAt)
    signals.push(signal(ORIGIN_CASE.absent, "IMG-META-001", UNUSUAL));
  else {
    signals.push(
      signal(ORIGIN_CASE.declared, "IMG-META-001", OBSERVED, { device: device ?? "—", software: software ?? "—" }),
    );
    if (!device) signals.push(signal(ORIGIN_CASE.noDevice, "IMG-META-005", OBSERVED));
  }
  if (takenAt && modifiedAt) {
    const gap = differenceInSeconds(parseISO(modifiedAt), parseISO(takenAt));
    const dates = { taken: takenAt, modified: modifiedAt };
    if (gap < -rules.sameMomentSeconds)
      signals.push(signal(ORIGIN_CASE.modifiedBefore, "IMG-META-004", INCONSISTENT, dates));
    else if (gap > rules.sameMomentSeconds)
      signals.push(signal(ORIGIN_CASE.modifiedAfter, "IMG-META-003", UNUSUAL, dates));
  }
  if (hadGps) signals.push(signal(ORIGIN_CASE.gpsRemoved, "IMG-GPS-001", OBSERVED));
  return signals;
}
