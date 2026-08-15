"use client";

import { useState } from "react";
import type { ShippingQuoteInputBlock as ShippingQuoteInputBlockType } from "@/lib/types";

function maskCep(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export default function ShippingQuoteBlock({
  block,
  onQuickReply,
}: {
  block: ShippingQuoteInputBlockType;
  onQuickReply?: (text: string) => void;
}) {
  const { productName, productId } = block.data;
  const [cep, setCep] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const digits = cep.replace(/\D/g, "");
  const valid = digits.length === 8;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !onQuickReply) return;
    setSubmitting(true);
    onQuickReply(`Calcular frete para ${productName} CEP ${cep}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        borderRadius: "var(--aacp-radius-md)",
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "var(--aacp-shadow-sm)",
      }}
    >
      <div
        style={{
          fontSize: 13.5,
          fontWeight: 600,
          color: "var(--aacp-fg)",
          lineHeight: 1.35,
        }}
      >
        Calcular frete para {productName}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--aacp-muted)",
          letterSpacing: 0.2,
        }}
      >
        Informe seu CEP para ver opcoes de entrega
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "stretch",
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="00000-000"
          value={cep}
          onChange={(e) => setCep(maskCep(e.target.value))}
          disabled={submitting}
          aria-label="CEP"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            borderRadius: "var(--aacp-radius-sm)",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-surface-2)",
            color: "var(--aacp-fg)",
            fontSize: 14,
            fontFamily: "var(--aacp-font-mono)",
            letterSpacing: 0.5,
            outline: "none",
            transition: "border-color 160ms ease",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--aacp-accent)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--aacp-line)")}
        />
        <button
          type="submit"
          disabled={!valid || submitting}
          style={{
            padding: "0 16px",
            borderRadius: "var(--aacp-radius-sm)",
            border: "none",
            background: valid ? "var(--aacp-grad-primary)" : "var(--aacp-surface-3)",
            color: valid ? "#fff" : "var(--aacp-muted)",
            fontSize: 13,
            fontWeight: 600,
            cursor: valid && !submitting ? "pointer" : "not-allowed",
            transition: "opacity 160ms ease, transform 160ms ease",
            boxShadow: valid ? "var(--aacp-shadow-sm)" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {submitting ? "..." : "Calcular"}
        </button>
      </div>

      <div
        style={{
          fontSize: 10.5,
          color: "var(--aacp-faint)",
          fontFamily: "var(--aacp-font-mono)",
          letterSpacing: 0.3,
        }}
      >
        produto: {productId}
      </div>
    </form>
  );
}
