/**
 * PaymentSelector — legacy standalone component.
 * In the chat-driven flow, payment methods are rendered inline
 * by the PaymentMethodsBlock inside ChatPanel via BlockRenderer.
 * This file is kept for backward compatibility.
 */
import { useCheckoutStore } from "@/store/checkout-store";
import { StripeCardPayment } from "./StripeCardPayment";

export interface PaymentMethod {
  key: string;
  label: string;
  sub: string;
}

export function PaymentSelector() {
  const paymentIntent = useCheckoutStore((s) => s.paymentIntent);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);

  // If Stripe card payment is active, show that
  if (paymentIntent?.stripe_client_secret) {
    return <StripeCardPayment />;
  }

  return (
    <div style={{ padding: "16px", textAlign: "center", color: "var(--mut)" }}>
      <p style={{ fontSize: "13px" }}>
        As formas de pagamento aparecem no chat. Envie uma mensagem para continuar.
      </p>
      <button
        type="button"
        onClick={() => void sendMessage("Mostrar formas de pagamento")}
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
        Ver formas de pagamento
      </button>
    </div>
  );
}
