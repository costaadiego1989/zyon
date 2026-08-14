"use client";

import type { CheckoutRedirectBlock as CheckoutRedirectBlockType } from "@/lib/types.js";

export default function CheckoutRedirectBlock({
  block,
}: {
  block: CheckoutRedirectBlockType;
}) {
  const { url } = block.data;

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
      }}
    >
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
        target="_blank"
        rel="noopener noreferrer"
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
        }}
      >
        Ir para checkout →
      </a>
    </div>
  );
}
