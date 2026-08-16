import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@zyon/checkout-ui"],
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3001"],
    },
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009",
    NEXT_PUBLIC_WIDGET_BASE_URL:
      process.env.NEXT_PUBLIC_WIDGET_BASE_URL ?? "http://localhost:5173",
  },
};

export default config;
