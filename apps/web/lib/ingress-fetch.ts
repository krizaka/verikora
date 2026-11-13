import { configureKrizakaFetch } from "@krizaka/query";
import { restoreRefusal } from "@verikora/core";

/**
 * Makes every `krizakaFetch` of the page read a refusal the DigitalOcean ingress rewrote (502 → bare 504 page) as the JSON it was:
 * the code comes back from `X-Error-Code` (krizaka-internal#3225). Returns the function that undoes it.
 */
export function installIngressAwareFetch(base: typeof fetch = (...args) => fetch(...args)): () => void {
  return configureKrizakaFetch({
    fetch: async (...args: Parameters<typeof fetch>) => restoreRefusal(await base(...args)),
  });
}
