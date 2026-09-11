"use client";

import { useEffect } from "react";

/** Sinaliza a hidratação de uma loja autorizada com configuração real da API. */
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
    const announce = (origin: string) => {
      if (allowedOrigins.includes(origin)) {
        window.parent.postMessage({ type: "zyon-demo-ready", version: 1 }, origin);
      }
    };
    // Responder somente à janela pai e à origem autorizada, sem mensagens cruzadas.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !allowedOrigins.includes(event.origin)) return;
      if (event.data?.type !== "zyon-demo-ping" || event.data?.version !== 1) return;
      announce(event.origin);
    };
    window.addEventListener("message", onMessage);
    if (document.referrer) {
      try { announce(new URL(document.referrer).origin); } catch { /* Sem origem válida, aguarda o ping. */ }
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return null;
}
