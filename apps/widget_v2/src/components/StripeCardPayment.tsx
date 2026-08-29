import { useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { useCheckoutStore } from "@/store/checkout-store";

const STRIPE_PK = (typeof window !== "undefined" && window.__STRIPE_PK__)
  || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  || "pk_test_placeholder";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise;
}

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const paymentIntent = useCheckoutStore((s) => s.paymentIntent);
  const api = useCheckoutStore((s) => s.api);
  const brand = useCheckoutStore((s) => s.brand);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !paymentIntent?.stripe_client_secret || !api) return;

    setProcessing(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) { setProcessing(false); return; }

    const { error: stripeError, paymentIntent: result } = await stripe.confirmCardPayment(
      paymentIntent.stripe_client_secret,
      { payment_method: { card: cardElement } }
    );

    if (stripeError) {
      setError(stripeError.message || "Erro no pagamento");
      setProcessing(false);
      return;
    }

    if (result?.status === "succeeded") {
      try {
        const confirmRes = await fetch(
          `${api.apiBaseUrl}/embed/payment/intents/${paymentIntent.intent_id}/stripe/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.authToken}` },
            body: JSON.stringify({ payment_intent_id: result.id }),
          }
        );
        if (confirmRes.ok) {
          setSuccess(true);
          useCheckoutStore.setState({
            status: "completed",
            cart: { ...useCheckoutStore.getState().cart, status: "paid" }
          });
        } else {
          setError("Pagamento processado mas confirmação falhou. Entre em contato.");
        }
      } catch {
        setError("Erro de conexão na confirmação.");
      }
    } else {
      setError("Pagamento não foi concluído. Tente novamente.");
    }
    setProcessing(false);
  };

  if (success) {
    return (
      <div className="stripe-payment stripe-payment--success">
        <div className="stripe-payment__icon">✓</div>
        <h3>Pagamento aprovado!</h3>
        <p>Seu pedido está sendo processado.</p>
      </div>
    );
  }

  const isDark = brand?.mode === "dark";
  const textColor = brand?.textColor || (isDark ? "#f1f5f9" : "#111827");
  const placeholderColor = brand?.mutedTextColor || (isDark ? "#94a3b8" : "#64748b");

  const cardStyle = {
    base: {
      fontSize: "16px",
      color: textColor,
      fontFamily: brand?.fontFamily || "Inter, sans-serif",
      "::placeholder": { color: placeholderColor },
    },
    invalid: { color: "#dc2626" },
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="stripe-payment">
      <h3 className="stripe-payment__title">Cartão de Crédito</h3>
      <div className="stripe-payment__card-wrapper">
        <CardElement options={{ style: cardStyle, hidePostalCode: true }} />
      </div>
      {error && <p className="stripe-payment__error">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="stripe-payment__submit"
      >
        {processing ? "Processando..." : "Pagar agora"}
      </button>
    </form>
  );
}

export function StripeCardPayment() {
  const paymentIntent = useCheckoutStore((s) => s.paymentIntent);

  if (!paymentIntent?.stripe_client_secret) {
    return <div className="stripe-payment__loading">Carregando pagamento...</div>;
  }

  return (
    <Elements stripe={getStripe()} options={{ clientSecret: paymentIntent.stripe_client_secret }}>
      <CardForm />
    </Elements>
  );
}
