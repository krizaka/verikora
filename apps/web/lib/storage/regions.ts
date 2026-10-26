/**
 * The country of each provider region this product can run on (data: a new region is a line here).
 * A region not listed is unknown: the residency test refuses to guess.
 */
export const COUNTRY_OF_REGION: Readonly<Record<string, string>> = {
  // DigitalOcean (App Platform `tor`, managed databases and Spaces `tor1`): Toronto.
  tor: "CA",
  tor1: "CA",
  // AWS and Azure Canadian regions.
  "ca-central-1": "CA",
  "ca-west-1": "CA",
  "ca-central": "CA",
  "ca-east": "CA",
  "ca-toronto-1": "CA",
  "ca-montreal-1": "CA",
  "canada-central": "CA",
  canadacentral: "CA",
  canadaeast: "CA",
  // OVHcloud Beauharnois (Québec).
  bhs: "CA",
  // Bunny Storage zones (`<region>.storage.bunnycdn.com`).
  ny: "US",
  la: "US",
  de: "DE",
  uk: "GB",
  sg: "SG",
  se: "SE",
  // DigitalOcean regions the platform might use later.
  nyc3: "US",
  sfo3: "US",
  ams3: "NL",
  fra1: "DE",
  lon1: "GB",
  sgp1: "SG",
  blr1: "IN",
  syd1: "AU",
};

/** The ISO country of a provider region, or undefined when the region is not mapped. */
export const countryOf = (region: string): string | undefined => COUNTRY_OF_REGION[region.toLowerCase()];

export const residencyOf = (region: string): "canada" | "elsewhere" => (countryOf(region) === "CA" ? "canada" : "elsewhere");
