import { COUNTRY_OF_REGION } from "../storage/regions";

/**
 * The data zone a sealed contract is kept in (`X-Data-Residency-Zone`): `CA` (Canada) or a province, `CA-QC`. A region not listed
 * is in no zone — the seal then refuses rather than say it is somewhere it cannot prove (the residency test's own rule).
 */
const PROVINCE_OF_REGION: Readonly<Record<string, string>> = {
  // Montréal and Québec City.
  "ca-central-1": "CA-QC",
  "ca-montreal-1": "CA-QC",
  canadaeast: "CA-QC",
  bhs: "CA-QC",
  // Toronto (DigitalOcean `tor`, `tor1`) and Azure Canada Central.
  tor: "CA-ON",
  tor1: "CA-ON",
  "ca-toronto-1": "CA-ON",
  canadacentral: "CA-ON",
  // Calgary.
  "ca-west-1": "CA-AB",
};

export const ZONE = /^CA(-[A-Z]{2})?$/;

/** The zones a region is in, widest first (`["CA", "CA-ON"]`): empty when the region is not known to be in Canada. */
export function zonesOfRegion(region: string | null): string[] {
  if (!region) return [];
  const key = region.toLowerCase();
  if (COUNTRY_OF_REGION[key] !== "CA") return [];
  const province = PROVINCE_OF_REGION[key];
  return province ? ["CA", province] : ["CA"];
}

/** Whether a store in `region` is in the zone the caller asked for. */
export const inZone = (region: string | null, zone: string): boolean => zonesOfRegion(region).includes(zone);
