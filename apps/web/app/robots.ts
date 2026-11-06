import type { MetadataRoute } from "next";

import { indexableOn } from "@/lib/indexing";
import { CRAWLERS } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/** The public pages are open to every crawler; the signed-in space and the API are not for them. */
export default function robots(): MetadataRoute.Robots {
  // The public file. A host that is not indexed (dev, admin, a closed deployment) is answered closed by the proxy at request time.
  const disallow = [
    "/api/",
    "/en/app",
    "/fr/app",
    "/en/sign-in",
    "/fr/sign-in",
    "/en/forgot-password",
    "/fr/forgot-password",
    "/en/reset-password",
    "/fr/reset-password",
  ];
  // The code-name address is closed, with no sitemap (the public address is www.verikora.com): the proxy answers the same.
  if (!indexableOn(new URL(SITE_URL).host)) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      ...CRAWLERS.map((userAgent) => ({ userAgent, allow: "/", disallow })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
