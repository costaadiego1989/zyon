import { ImageResponse } from "next/og";
import { fetchStoreConfig } from "@/lib/api/server-client";

export const alt = "Store preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;

  let storeName = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  let accentColor = "#0F766E";
  let storeCategory = "Loja Online";

  try {
    const config = await fetchStoreConfig(slug);
    if (config) {
      storeName = config.name || storeName;
      accentColor = config.theme?.accentColor || accentColor;
      storeCategory = config.storeCategory || storeCategory;
    }
  } catch {
    // Use defaults on failure
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#08080c",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Accent border top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "6px",
            background: accentColor,
          }}
        />

        {/* Logo initial circle */}
        <div
          style={{
            width: "120px",
            height: "120px",
            borderRadius: "60px",
            background: accentColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "32px",
            boxShadow: `0 0 60px ${accentColor}44`,
          }}
        >
          <span
            style={{
              fontSize: "56px",
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1,
            }}
          >
            {storeName.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Store name */}
        <div
          style={{
            fontSize: "52px",
            fontWeight: 700,
            color: "#f5f5f7",
            letterSpacing: "-1px",
            textAlign: "center",
            maxWidth: "900px",
            lineHeight: 1.2,
          }}
        >
          {storeName}
        </div>

        {/* Category subtitle */}
        <div
          style={{
            fontSize: "24px",
            color: "#8b8b95",
            marginTop: "16px",
            letterSpacing: "0.5px",
          }}
        >
          {storeCategory}
        </div>

        {/* Bottom branding */}
        <div
          style={{
            position: "absolute",
            bottom: "28px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "16px",
            color: "#6c6a72",
          }}
        >
          <span>Powered by</span>
          <span style={{ fontWeight: 700, color: accentColor }}>Zyon</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
