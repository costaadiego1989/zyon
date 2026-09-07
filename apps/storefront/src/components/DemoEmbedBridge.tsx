"use client";

import { useEffect } from "react";

/** Mounted only after the API has supplied a real demo merchant. */
export function DemoEmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const allowedOrigins = [
      window.location.origin,
      "https://zyon-payments.com.br",
      "https://www.zyon-payments.com.br",
      "https://zyon-agentic-checkout.vercel.app",
      ...(process.env.NODE_ENV !== "production"
        ? ["http://localhost:4175", "http://127.0.0.1:4175"]
        : []),
    ];
    for (const origin of allowedOrigins) {
      window.parent.postMessage({ type: "zyon-demo-ready", version: 1 }, origin);
    }
  }, []);

  return null;
}
