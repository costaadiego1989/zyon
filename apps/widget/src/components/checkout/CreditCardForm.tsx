import { type FormEvent, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CreditCard, Lock, AlertCircle, Loader2 } from "lucide-react";
import type { CreditCardFormModel } from "../../presentation/models/credit-card-form.model.js";
import { formatCurrency } from "../../hooks/checkout-presentation.js";

export const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();

function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache.has(publishableKey)) {
    stripePromiseCache.set(publishableKey, loadStripe(publishableKey));
  }
  return stripePromiseCache.get(publishableKey)!;
}

function StripePaymentForm({ model }: { model: CreditCardFormModel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = model.stripeIntent;
  const total = intent
    ? formatCurrency(intent.amountCents / 100, intent.currency)
    : "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || !intent) return;
    setSubmitting(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    setSubmitting(false);

    if (stripeError) {
      setError(stripeError.message ?? "Pagamento recusado.");
      model.onStripePaymentError(stripeError.message ?? "Pagamento recusado.");
      return;
    }

    await model.onStripePaymentConfirmed(intent.amountCents, intent.currency);
    model.onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      {error ? (
        <div
          className="flex items-start gap-2 p-3 rounded-2xl text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-300"
          role="alert"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="rounded-xl overflow-hidden border border-[var(--aacp-line-strong)] bg-[var(--aacp-surface)] p-3 aacp-stripe-element-wrap">
        <PaymentElement
          options={{
            layout: "tabs",
            wallets: { applePay: "never", googlePay: "never" },
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!stripe || submitting}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--aacp-enterprise-ink,var(--continuum-primary,#14532d))] text-[var(--aacp-enterprise-surface,var(--continuum-on-primary,#fff))] shadow-[var(--aacp-shadow-md)]"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Processando...
            </>
          ) : (
            <>
              <Lock size={14} />
              Pagar {total}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => model.onClose()}
          disabled={submitting}
          className="px-4 py-3.5 rounded-xl text-xs font-bold transition-all bg-[rgba(255,255,255,0.03)] border border-[var(--aacp-line-strong)] text-[var(--aacp-muted)] hover:text-[var(--aacp-fg)] hover:border-[var(--aacp-line)]"
        >
          Cancelar
        </button>
      </div>

      <div className="flex items-center justify-center gap-2 text-[10px] text-[var(--aacp-faint)]">
        <Lock size={10} />
        <span>Dados do cartão processados diretamente pela Stripe · PCI DSS SAQ A</span>
      </div>
    </form>
  );
}

export function CreditCardForm({ model }: { model: CreditCardFormModel }) {
  const [loading, setLoading] = useState(false);
  const intent = model.stripeIntent;
  const isDark = model.colorMode === "dark";
  const stripeAppearance = isDark
    ? {
        theme: "night" as const,
        variables: {
          colorPrimary: "#6ee7b7",
          colorBackground: "#111827",
          colorText: "#f8fafc",
          colorDanger: "#f87171",
          borderRadius: "12px",
        },
      }
    : {
        theme: "stripe" as const,
        variables: {
          colorPrimary: "#14532d",
          colorBackground: "#ffffff",
          colorText: "#0f172a",
          colorTextSecondary: "#475569",
          colorDanger: "#dc2626",
          borderRadius: "12px",
        },
      };

  async function handleInitiate() {
    setLoading(true);
    await model.onInitiate();
    setLoading(false);
  }

  return (
    <div className="rounded-3xl border p-5 shadow-lg backdrop-blur-xl transition-all duration-300 bg-[var(--aacp-surface-2)] border-[var(--aacp-line-strong)]">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-[var(--aacp-surface-3)] text-[var(--aacp-accent)]">
          <CreditCard size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <strong className="block text-sm font-bold text-[var(--aacp-fg)]">
            Pagamento com cartão
          </strong>
          <span className="block text-xs text-[var(--aacp-muted)]">
            Total: {model.totalLabel} · Protegido pela Stripe
          </span>
        </div>
        <Lock size={14} className="text-[var(--aacp-success)]" />
      </div>

      {intent ? (
        <Elements
          stripe={getStripePromise(intent.publishableKey)}
          options={{
            clientSecret: intent.clientSecret,
            appearance: stripeAppearance,
            locale: "pt-BR",
          }}
        >
          <StripePaymentForm model={model} />
        </Elements>
      ) : (
        <button
          onClick={handleInitiate}
          disabled={loading || model.busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--aacp-enterprise-ink,var(--continuum-primary,#14532d))] text-[var(--aacp-enterprise-surface,var(--continuum-on-primary,#fff))] shadow-[var(--aacp-shadow-md)]"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Preparando pagamento...
            </>
          ) : (
            <>
              <Lock size={14} />
              Pagar com cartão · {model.totalLabel}
            </>
          )}
        </button>
      )}
    </div>
  );
}
