import { ImageResponse } from "next/og";

import { markDataUri } from "@/lib/og-mark";
import { PRODUCT_NAME } from "@/lib/brand";

export const dynamic = "force-static";

/** The social card, drawn at build: the name, the promise, the ink indigo of the brand. */
export async function GET() {
  const mark = await markDataUri();
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
      <div style={{ fontSize: 48, fontWeight: 700, marginTop: 40 }}>Read before you sign.</div>
      <div style={{ fontSize: 28, marginTop: 20, color: "#a1a1aa" }}>
        Leases, contracts and invoices — read and checked, every finding quoted.
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
