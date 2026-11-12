import { ImageResponse } from "next/og";

import { PRODUCT_NAME } from "@/lib/brand";
import { getDictionary } from "@/lib/i18n";
import { markDataUri } from "@/lib/og-mark";

export const dynamic = "force-static";

/** The social card, drawn at build: the name, the promise, the ink indigo of the brand. */
export async function GET() {
  const mark = await markDataUri();
  const en = getDictionary("en");
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "linear-gradient(135deg, #121321 0%, #111019 55%, #0c0c0e 100%)",
        color: "#f4f4f5",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by ImageResponse, not a page */}
        <img src={mark} width={96} height={96} alt="" />
        <div style={{ fontSize: 64, fontWeight: 800 }}>{PRODUCT_NAME}</div>
      </div>
      <div style={{ fontSize: 52, fontWeight: 700, marginTop: 40 }}>{en.landing.title}</div>
      <div style={{ fontSize: 26, marginTop: 20, color: "#a1a1aa" }}>{en.meta.description}</div>
    </div>,
    { width: 1200, height: 630 },
  );
}
