import type { NextConfig } from "next";

const publicApiBaseUrl =
  process.env.NODE_ENV === "production"
    ? "/api/v1"
    : process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";

const config: NextConfig = {
  reactStrictMode: true,
  devIndicators: process.env.AACP_VISUAL_REVIEW === "1" ? false : undefined,
  transpilePackages: ["@zyon/checkout-ui", "@zyon/widget-v2"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3001", "storefront.zyon-payments.com.br"],
    },
  },
  env: {
    // Browser requests stay same-origin in production. The route handler uses
    // AACP_API_URL server-side, avoiding a fragile public API hostname/CORS hop.
    NEXT_PUBLIC_API_BASE_URL: publicApiBaseUrl,
    NEXT_PUBLIC_WIDGET_BASE_URL:
      process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173",
  },
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    // In dev, the API (localhost:3009), widget (localhost:5174) and Google Fonts
    // are served over http/cross-origin, so the strict prod CSP would block them.
    // Relax connect/style/font sources for local development only.
    const devConnect = isDev
      ? " http://localhost:3009 http://localhost:5174 http://127.0.0.1:3009 ws://localhost:3001 ws://localhost:3009"
      : "";
    const devStyle = isDev ? " https://fonts.googleapis.com" : "";
    const devFont = isDev ? " https://fonts.gstatic.com" : "";
    const contentSecurityPolicy = (frameAncestors: string) => [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com https://js.stripe.com",
      `style-src 'self' 'unsafe-inline'${devStyle}`,
      "img-src 'self' data: https: blob:",
      `connect-src 'self' https: wss://api.zyon-payments.com.br${devConnect} https://api.stripe.com`,
      "frame-src 'self' https://www.googletagmanager.com https://js.stripe.com https://hooks.stripe.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
      "media-src 'self' https: blob:",
      `font-src 'self' data: https:${devFont}`,
      `frame-ancestors ${frameAncestors}`,
    ].join("; ");

    const commonHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];

    return [
      {
        // Only the dedicated demo may be framed by Zyon's marketing surfaces.
        source: "/store/demo",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(
              "'self' https://zyon-payments.com.br https://www.zyon-payments.com.br https://zyon-agentic-checkout.vercel.app" +
              (isDev ? " http://localhost:4175 http://127.0.0.1:4175" : ""),
            ),
          },
          ...commonHeaders,
        ],
      },
      {
        // Keep every merchant storefront protected from third-party framing.
        source: "/:path((?!store/demo$).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy("'none'"),
          },
          { key: "X-Frame-Options", value: "DENY" },
          ...commonHeaders,
        ],
      },
    ];
  },
};

export default config;
