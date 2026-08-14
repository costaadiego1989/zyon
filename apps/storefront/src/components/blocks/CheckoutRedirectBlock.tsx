"use client";

import { useEffect, useState } from "react";
import type { CheckoutRedirectBlock as CheckoutRedirectBlockType } from "@/lib/types.js";

export default function CheckoutRedirectBlock({
  block,
}: {
  block: CheckoutRedirectBlockType;
}) {
  const { url } = block.data;
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // Auto-redirect after 1.5s
    const timer = setTimeout(() => {
      setIsRedirecting(true);
      window.location.href = url;
    }, 1500);

    return () => clearTimeout(timer);
  }, [url]);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        padding: 16,
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "center",
      }}
    >
      {isRedirecting ? (
        <>
          <span
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-fg)",
            }}
          >
            Finalizando sua compra...
          </span>
          <div
            style={{
              display: "inline-flex",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-primary)",
                animation: "pulse 1.5s infinite",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-primary)",
                animation: "pulse 1.5s infinite 0.5s",
              }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--color-primary)",
                animation: "pulse 1.5s infinite 1s",
              }}
            />
          </div>
          <style>{`
            @keyframes pulse {
              0%, 100% { opacity: 0.4; }
              50% { opacity: 1; }
            }
          `}</style>
        </>
      ) : (
        <>
          <span
            style={{
              fontSize: 13,
              color: "var(--color-fg-soft)",
            }}
          >
            Tudo certo! Finalize o pagamento no checkout seguro.
          </span>
          <a
            href={url}
            style={{
              display: "inline-block",
              padding: "10px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--color-primary)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
              textAlign: "center",
              cursor: "pointer",
            }}
          >
            Ir para pagamento →
          </a>
        </>
      )}
    </div>
  );
}
