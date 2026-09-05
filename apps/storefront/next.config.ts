import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@zyon/checkout-ui", "@zyon/widget-v2"],
  serverExternalPackages: ["jsdom", "isomorphic-dompurify"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3001", "storefront.zyon-payments.com.br"],
    },
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009",
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
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com https://js.stripe.com",
              `style-src 'self' 'unsafe-inline'${devStyle}`,
              "img-src 'self' data: https: blob:",
              `connect-src 'self' https: wss://api.zyon-payments.com.br${devConnect} https://api.stripe.com`,
              "frame-src 'self' https://www.googletagmanager.com https://js.stripe.com https://hooks.stripe.com",
              `font-src 'self' data: https:${devFont}`,
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
