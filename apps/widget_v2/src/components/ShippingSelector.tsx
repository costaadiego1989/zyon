/**
 * ShippingSelector — legacy standalone component.
 * In the chat-driven flow, shipping options are rendered inline
 * by the ShippingOptionsBlock inside ChatPanel via BlockRenderer.
 * This file is kept for backward compatibility.
 */
import { useCheckoutStore } from "@/store/checkout-store";

export interface ShippingOption {
  key: string;
  label: string;
  tag: string;
  sub: string;
  cost: number;
}

export function ShippingSelector() {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);

  return (
    <div style={{ padding: "16px", textAlign: "center", color: "var(--mut)" }}>
      <p style={{ fontSize: "13px" }}>
        As opcoes de frete aparecem no chat. Envie uma mensagem para continuar.
      </p>
      <button
        type="button"
        onClick={() => void sendMessage("Mostrar opcoes de frete")}
        style={{
          marginTop: "8px",
          padding: "8px 16px",
          borderRadius: "8px",
          background: "var(--aacp-accent, #0f766e)",
          color: "#fff",
          border: "none",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Ver opcoes de frete
      </button>
    </div>
  );
}
