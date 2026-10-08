import { useState, useEffect, useMemo, useRef, type ReactNode, type CSSProperties } from "react";
import { useModalFocus } from "@zyon/checkout-ui/modal-focus";
import { createPortal } from "react-dom";
import CatalogProductCard, { catalogProductStyles } from "@zyon/checkout-ui/catalog-product-card";
import { paymentMethodsForConfig, useCheckoutStore } from "@/store/checkout-store";
import { confirmCryptoPayment } from "@/api/payment";
import { PulseAgentOrb } from "../PulseAgentOrb";
import { PerimeterBorder } from "../PerimeterBorder";
import type { ChatBlock } from "@/api/checkout-session";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { trackEvent } from "@/lib/tracking";
import { translateShippingLabel } from "./helpers";
import { buyerServiceFeeCopy, checkoutLocale } from "@/lib/checkout-totals";
import { CheckoutHelpBlock, CheckoutAlternativesBlock } from "./CheckoutHelpBlock";
import { PixPayment } from "../PixPayment";

function BuyerServiceFeeNotice() {
  const serviceFee = useCheckoutStore((s) => s.cart.serviceFee);
  const language = useCheckoutStore((s) => s.agent.language);
  if (serviceFee <= 0) return null;
  const copy = buyerServiceFeeCopy(language);
  const feeLabel = new Intl.NumberFormat(checkoutLocale(language), { style: "currency", currency: "BRL" }).format(serviceFee);
  return (
    <p data-testid="buyer-service-fee-notice" style={{ fontSize: "11px", color: "var(--mut)", margin: "8px 0 0", lineHeight: 1.4 }}>
      <strong>{copy.label}: {feeLabel}.</strong> {copy.notice}
    </p>
  );
}

function PaymentPanel({
  title,
  description,
  totalLabel,
  children,
  status,
}: {
  title: string;
  description: string;
  totalLabel?: string | null;
  children?: ReactNode;
  status?: string;
}) {
  return (
    <section data-neu="surface" className="checkout-payment-panel" aria-label={title}>
      <header className="checkout-payment-panel__header">
        <span className="checkout-payment-panel__mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="7" width="16" height="12" rx="2.5" />
            <path d="M8 7V5.8a4 4 0 0 1 8 0V7" />
            <path d="M8 13h8" />
          </svg>
        </span>
        <div>
          <p className="checkout-payment-panel__eyebrow">Pagamento seguro</p>
          <h3>{title}</h3>
        </div>
      </header>
      <p className="checkout-payment-panel__description">{description}</p>
      {totalLabel && (
        <div className="checkout-payment-panel__total">
          <span>Total a pagar</span>
          <strong>{totalLabel}</strong>
        </div>
      )}
      <BuyerServiceFeeNotice />
      {children && <div className="checkout-payment-panel__body">{children}</div>}
      {status && (
        <footer className="checkout-payment-panel__status" aria-live="polite">
          <span aria-hidden="true" />
          {status}
        </footer>
      )}
    </section>
  );
}

function PaymentCompleted({ description = "Seu pedido estÃƒÂ¡ sendo processado." }: { description?: string }) {
  return (
    <section data-neu="surface" className="checkout-payment-panel checkout-payment-panel--completed" aria-label="Pagamento confirmado">
      <span className="checkout-payment-panel__success" aria-hidden="true">Ã¢Å“â€œ</span>
      <div>
        <h3>Pagamento confirmado</h3>
        <p>{description}</p>
      </div>
    </section>
  );
}

function CheckoutPriceReviewBlock({ fingerprint }: { fingerprint: unknown }) {
  const pending = useCheckoutStore(s => s.pendingPriceReview);
  const busy = useCheckoutStore(s => s.paymentSubmitting || s.cartUpdating);
  const confirm = useCheckoutStore(s => s.confirmUpdatedOrder);
  if (!pending || pending.review.confirmation_fingerprint !== fingerprint) return null;
  const total = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(pending.review.total_to_pay_cents / 100);
  return <PaymentPanel title="Confira o novo total" totalLabel={total}
    description="O pedido estÃƒÂ¡ sem o desconto anterior. Confirme este valor para continuar com o pagamento.">
    <button type="button" data-neu="control" className="checkout-payment-panel__action" disabled={busy}
      onClick={() => { void confirm(pending.review.confirmation_fingerprint); }}>
      {busy ? "Preparando pagamento..." : `Confirmar pedido de ${total}`}
    </button>
  </PaymentPanel>;
}

function CartSummaryBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  const items = (data.items as Array<{ name: string; qty?: number; quantity?: number; total?: string; price?: number }>) ?? [];
  const total = data.total as number | undefined;
  const discount = data.discount as number | undefined;

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div data-neu="surface" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Resumo do carrinho</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--mut)", padding: "4px 0" }}>
          <span>{item.name} x{item.qty ?? item.quantity ?? 1}</span>
          <span>{item.total ?? (item.price != null ? formatPrice(item.price) : "")}</span>
        </div>
      ))}
      {discount != null && discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--aacp-accent-text, var(--aacp-accent, #0f766e))", padding: "4px 0" }}>
          <span>Desconto</span>
          <span>-{formatPrice(discount)}</span>
        </div>
      )}
      {total != null && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 600, borderTop: "1px solid var(--bd)", paddingTop: "8px", marginTop: "8px" }}>
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      )}
    </div>
  );
}

function ShippingOptionsBlock({ options, selectionMode }: { options?: unknown; selectionMode?: unknown }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const selectShipping = useCheckoutStore((s) => s.selectShipping);
  const selectedShipping = useCheckoutStore((s) => s.cart.shipping);
  const cartUpdating = useCheckoutStore((s) => s.cartUpdating);
  const chatBusy = useCheckoutStore((s) => s.isTyping || Boolean(s.chatRecovery));
  const preference = useCheckoutStore((s) => s.oneBuyClickPreferences?.shippingPreference);
  const opts = ((options as Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>) ?? [])
    .filter((o) => o && o.key && o.label)
    .sort((left, right) => shippingPriority(left, preference) - shippingPriority(right, preference));

  const handleSelect = async (opt: (typeof opts)[0]) => {
    if (selectionMode === "chat") {
      await sendMessage(`Entrega Ã‚Â· ${opt.label}`);
      return;
    }
    const selected = await selectShipping({ key: opt.key, label: translateShippingLabel(opt.label) });
    if (!selected) return;
    void sendMessage(`Entrega Ã‚Â· ${translateShippingLabel(opt.label)}`);
  };

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Escolha o frete:</div>
      {opts.map((opt) => (
        <button data-neu="choice"
          key={opt.key}
          disabled={cartUpdating || (selectionMode === "chat" && chatBusy)}
          aria-pressed={selectedShipping?.key === opt.key}
          onClick={() => void handleSelect(opt)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: selectedShipping?.key === opt.key ? "1px solid var(--aacp-accent, #0f766e)" : "1px solid var(--bd)",
            background: selectedShipping?.key === opt.key ? "color-mix(in srgb, var(--aacp-accent, #0f766e) 9%, var(--chip))" : "var(--chip)",
            color: "var(--tx)",
            cursor: cartUpdating ? "wait" : "pointer",
            textAlign: "left",
            fontSize: "13px",
            opacity: cartUpdating && selectedShipping?.key !== opt.key ? 0.58 : 1,
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{translateShippingLabel(opt.label)}</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-accent-text, var(--aacp-accent, #0f766e))" }}>
              {opt.cost === 0 ? "GrÃƒÂ¡tis" : opt.cost != null ? formatPrice(opt.cost / 100) : ""}
            </span>
          </div>
          {preference && opts[0]?.key === opt.key && <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--aacp-accent-text, var(--aacp-accent))", marginTop: "3px" }}>Prioridade da compra rÃƒÂ¡pida</div>}
          {opt.sub && <div style={{ fontSize: "11px", color: "var(--mut)", marginTop: "2px" }}>{opt.sub}</div>}
          {selectedShipping?.key === opt.key && <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--aacp-accent-text, var(--aacp-accent))", marginTop: "4px" }}>Frete selecionado</div>}
        </button>
      ))}
    </div>
  );
}

function shippingPriority(
  option: { sub?: string; cost?: number },
  preference: "fastest" | "cheapest" | undefined,
): number {
  if (!preference) return 0;
  if (preference === "cheapest") return option.cost ?? Number.MAX_SAFE_INTEGER;
  const days = Number(option.sub?.match(/(\d+)\s*dias?/i)?.[1]);
  return Number.isFinite(days) ? days : Number.MAX_SAFE_INTEGER;
}

function PaymentMethodsBlock({ methods }: { methods?: unknown }) {
  const pay = useCheckoutStore((s) => s.pay);
  const busy = useCheckoutStore(s => s.paymentCreating || s.paymentSubmitting || s.assistanceBusy || s.cartUpdating || s.paymentObservation || s.status !== "active");
  const merchantPaymentConfig = useCheckoutStore((s) => s.merchantPaymentConfig);
  const preference = useCheckoutStore((s) => s.oneBuyClickPreferences?.paymentPreference);
  const permittedKeys = new Set(paymentMethodsForConfig(merchantPaymentConfig).map((method) => method.key));
  const meths = ((methods as Array<{ key: string; label: string; sub?: string }>) ?? [])
    .filter((method) => permittedKeys.has(method.key))
    .sort((left, right) => paymentPriority(left.key, preference) - paymentPriority(right.key, preference));

  const handleSelect = (method: (typeof meths)[0]) => {
    void pay(method.key as "pix" | "boleto" | "credito" | "debito" | "crypto");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Forma de pagamento:</div>
      <BuyerServiceFeeNotice />
      {meths.map((m) => (
        <button data-neu="choice"
          key={m.key}
          disabled={busy}
          onClick={() => handleSelect(m)}
          style={{
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: 600 }}>Confirmar pagamento com {m.label}</div>
          {preference && meths[0]?.key === m.key && <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--aacp-accent-text, var(--aacp-accent))", marginTop: "3px" }}>PreferÃƒÂªncia da compra rÃƒÂ¡pida</div>}
          {m.sub && <div style={{ fontSize: "11px", color: "var(--mut)" }}>{m.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function paymentPriority(
  method: string,
  preference: "pix" | "card" | undefined,
): number {
  if (!preference) return 0;
  const preferred = preference === "card" ? "credito" : "pix";
  return method === preferred ? 0 : 1;
}

function PixPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  return <PixPayment data={data} />;
}

function safeInvoiceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function BoletoPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const stopPolling = useCheckoutStore((s) => s.stopPolling);
  const status = useCheckoutStore((s) => s.status);
  const language = useCheckoutStore((s) => s.agent.language);
  const invoiceUrl = safeInvoiceUrl(data?.invoice_url);
  const hostedCard = data?.hosted_card === true;
  const amountCents = data?.amount_cents;
  const totalLabel = typeof amountCents === "number" && Number.isSafeInteger(amountCents) && amountCents > 0
    ? new Intl.NumberFormat(checkoutLocale(language), { style: "currency", currency: "BRL" }).format(amountCents / 100)
    : null;

  useEffect(() => {
    if (!invoiceUrl) return;
    pollPayment();
    return () => stopPolling();
  }, [invoiceUrl, pollPayment, stopPolling]);

  if (!invoiceUrl) {
    return (
      <section data-neu="surface" className="checkout-payment-panel checkout-payment-panel--error" role="alert">
        <h3>Pagamento indisponÃƒÂ­vel</h3>
        <p>NÃƒÂ£o foi possÃƒÂ­vel abrir o pagamento com seguranÃƒÂ§a. Escolha outra forma de pagamento.</p>
      </section>
    );
  }

  if (status === "completed") {
    return <PaymentCompleted />;
  }

  return (
    <PaymentPanel
      title={hostedCard ? "CartÃƒÂ£o de crÃƒÂ©dito" : "Boleto"}
      description={hostedCard
        ? "VocÃƒÂª serÃƒÂ¡ direcionado ÃƒÂ  pÃƒÂ¡gina segura do provedor para informar o cartÃƒÂ£o."
        : "Abra o boleto em uma nova aba. A compensaÃƒÂ§ÃƒÂ£o serÃƒÂ¡ confirmada aqui."}
      totalLabel={totalLabel}
      status={hostedCard ? "Aguardando a confirmaÃƒÂ§ÃƒÂ£o do provedor" : "Aguardando a compensaÃƒÂ§ÃƒÂ£o do boleto"}
    >
      <a data-neu="primary" className="checkout-payment-panel__action" href={invoiceUrl} target="_blank" rel="noopener noreferrer">
        {hostedCard ? "Continuar para o pagamento seguro" : "Abrir boleto seguro"}
        <span aria-hidden="true">Ã¢â€ â€”</span>
      </a>
      <p className="checkout-payment-panel__hint">O pedido sÃƒÂ³ ÃƒÂ© confirmado depois da aprovaÃƒÂ§ÃƒÂ£o do pagamento.</p>
    </PaymentPanel>
  );
}

function StripeCardBlockForm({
  clientSecret,
  intentId,
  totalLabel,
}: {
  clientSecret: string;
  intentId: string;
  totalLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useCheckoutStore((s) => s.api);
  const brand = useCheckoutStore((s) => s.brand);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!stripe || !elements) {
      setError("Stripe nÃƒÂ£o carregou corretamente");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const existing = await stripe.retrievePaymentIntent(clientSecret);
      if (existing.paymentIntent?.status === "succeeded") {
        if (!api) {
          setError("NÃƒÂ£o foi possÃƒÂ­vel confirmar o pagamento com o servidor. Tente novamente.");
          return;
        }
        const confirmed = await api.confirmStripePayment(intentId);
        if ((confirmed as { status?: string }).status !== "approved") {
          setError("Pagamento processado, mas a confirmaÃƒÂ§ÃƒÂ£o do pedido ainda estÃƒÂ¡ pendente. Tente novamente.");
          return;
        }
        useCheckoutStore.setState((s) => ({
          status: "completed",
          cart: { ...s.cart, status: "paid" },
        }));
        void trackEvent("order_completed", { intent_id: intentId });
        setLoading(false);
        return;
      }

      const { paymentIntent, error: confirmError } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: elements.getElement(CardElement)!,
          },
        }
      );

      if (confirmError) {
        setError(confirmError.message || "Erro ao processar cartão");
        if (confirmError.type === "card_error" && confirmError.code === "card_declined") {
          void useCheckoutStore.getState().reportPaymentFailure(intentId);
        }
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded") {
        if (!api) {
          setError("NÃƒÂ£o foi possÃƒÂ­vel confirmar o pagamento com o servidor. Tente novamente.");
          return;
        }
        const confirmed = await api.confirmStripePayment(intentId);
        if ((confirmed as { status?: string }).status !== "approved") {
          setError("Pagamento processado, mas a confirmaÃƒÂ§ÃƒÂ£o do pedido ainda estÃƒÂ¡ pendente. Tente novamente.");
          return;
        }
        useCheckoutStore.setState((s) => ({
          status: "completed",
          cart: { ...s.cart, status: "paid" },
        }));
        void trackEvent("order_completed", { intent_id: intentId });
      } else {
        setError(`Pagamento nÃƒÂ£o foi concluÃƒÂ­do: ${paymentIntent?.status ?? "desconhecido"}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="checkout-payment-panel__stripe-form" onSubmit={handleSubmit}>
      <div className="checkout-payment-panel__card-field">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                color: brand?.textColor || (brand?.mode === "dark" ? "#f1f5f9" : "#111827"),
                fontFamily: brand?.fontFamily || "Inter, sans-serif",
                "::placeholder": {
                  color: brand?.mutedTextColor || (brand?.mode === "dark" ? "#94a3b8" : "#64748b"),
                },
              },
              invalid: {
                color: "#c92a2a",
              },
            },
          }}
        />
      </div>
      {error && (
        <div className="checkout-payment-panel__error" role="alert">
          {error}
        </div>
      )}
      <button data-neu="control"
        className="checkout-payment-panel__action"
        type="submit"
        disabled={!stripe || loading}
      >
        {loading ? "Processando..." : `Pagar ${totalLabel}`}
      </button>
    </form>
  );
}

const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(publishableKey: string, stripeAccountId?: string) {
  const cacheKey = `${publishableKey}:${stripeAccountId ?? "platform"}`;
  let p = stripePromiseCache.get(cacheKey);
  if (!p) {
    p = loadStripe(publishableKey, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined);
    stripePromiseCache.set(cacheKey, p);
  }
  return p;
}

function StripeCardBlock({ data }: { data?: Record<string, unknown> }) {
  const language = useCheckoutStore((s) => s.agent.language);
  const clientSecret = data?.stripe_client_secret as string | undefined;
  const publishableKey = data?.stripe_publishable_key as string | undefined;
  const stripeAccountId = data?.stripe_account_id as string | undefined;
  const intentId = data?.intent_id as string | undefined;
  const amountCents = data?.amount_cents;
  const elementsOptions = useMemo(() => ({ clientSecret }), [clientSecret]);

  if (!clientSecret || !publishableKey || !intentId || typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return (
      <section data-neu="surface" className="checkout-payment-panel checkout-payment-panel--error" role="alert">
        <h3>Pagamento indisponÃƒÂ­vel</h3>
        <p>NÃƒÂ£o foi possÃƒÂ­vel carregar os dados necessÃƒÂ¡rios. Escolha outra forma de pagamento.</p>
      </section>
    );
  }

  const stripePromise = getStripePromise(publishableKey, stripeAccountId);
  const totalLabel = new Intl.NumberFormat(checkoutLocale(language), { style: "currency", currency: "BRL" }).format(amountCents / 100);

  return (
    <PaymentPanel
      title="CartÃƒÂ£o de crÃƒÂ©dito"
      description="Confira o valor e informe o cartÃƒÂ£o neste ambiente seguro."
      totalLabel={totalLabel}
    >
      <Elements stripe={stripePromise} options={elementsOptions}>
        <StripeCardBlockForm clientSecret={clientSecret} intentId={intentId} totalLabel={totalLabel} />
      </Elements>
    </PaymentPanel>
  );
}

function OrderConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  return (
    <div data-neu="surface" style={{ padding: "16px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
        <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
          <PulseAgentOrb placement="chatBubble" active />
        </div>
      </div>
      <div style={{ fontSize: "28px", marginBottom: "6px" }}>Ã¢Å“â€œ</div>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--tx)" }}>
        {(data.title as string) || "Pedido confirmado!"}
      </div>
      {data.order_id ? (
        <div style={{ fontSize: "12px", color: "var(--mut)", marginTop: "4px" }}>
          Pedido #{String(data.order_id)}
        </div>
      ) : null}
      {data.message ? (
        <div style={{ fontSize: "13px", color: "var(--mut)", marginTop: "8px", lineHeight: 1.4 }}>
          {String(data.message)}
        </div>
      ) : null}
    </div>
  );
}

type CrossSellProduct = {
  id?: string; name: string; price?: number; priceFormatted?: string; image?: string;
  sku?: string; suggestionId?: string; variantId?: string; inStock?: boolean; discountPercent?: number;
};

function CrossSellBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore(s => s.sendMessage);
  const acceptCrossSell = useCheckoutStore(s => s.acceptCrossSell);
  const [dismissed, setDismissed] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalTheme, setPortalTheme] = useState<CSSProperties>({});
  const anchorRef = useRef<HTMLSpanElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const products = (data?.products as CrossSellProduct[]) ?? [];
  const mode = (data?.displayMode as string) ?? "inline";
  const close = () => { if (!pendingRef.current) setDismissed(true); };
  useModalFocus(mode === "modal" && !dismissed && products.length > 0, dialogRef, close, scopeRef);

  useEffect(() => {
    if (mode !== "modal" || !anchorRef.current) return;
    const computed = getComputedStyle(anchorRef.current);
    const inherited: Record<string, string> = { fontFamily: computed.fontFamily };
    for (let index = 0; index < computed.length; index++) {
      const name = computed[index];
      if (name.startsWith("--aacp-") || ["--bd", "--tx", "--mut"].includes(name)) inherited[name] = computed.getPropertyValue(name);
    }
    setPortalTheme(inherited as CSSProperties);
  }, [mode, data]);

  const addProduct = async (product: CrossSellProduct) => {
    if (product.inStock === false || pendingRef.current) return;
    pendingRef.current = true;
    setPendingKey(product.sku || product.variantId || product.name);
    setError(null);
    try {
      if (product.suggestionId && product.sku) {
        const result = await acceptCrossSell(product.suggestionId, product.sku);
        if (result.ok) setDismissed(true);
        else setError(result.error || "NÃƒÂ£o foi possÃƒÂ­vel adicionar este complemento.");
      } else {
        await sendMessage(`Adicionar ${product.name}${product.variantId ? ` [variantId:${product.variantId}]` : ""}`);
        setDismissed(true);
      }
    } catch {
      setError("NÃƒÂ£o foi possÃƒÂ­vel adicionar este complemento. Tente novamente.");
    } finally {
      pendingRef.current = false;
      setPendingKey(null);
    }
  };
  if (!data || !products.length || dismissed) return null;
  const cards = <div className={catalogProductStyles.carousel}>
    <div className={catalogProductStyles.track} tabIndex={0} aria-label="Produtos complementares; deslize para explorar">
      {products.map((product, index) => <CatalogProductCard key={product.suggestionId || product.variantId || product.sku || index}
        product={{ ...product, id: product.variantId || product.sku || product.id || String(index), price: product.price ?? 0,
          priceFormatted: product.priceFormatted || (product.price != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(product.price) : "PreÃƒÂ§o indisponÃƒÂ­vel"), inStock: product.inStock !== false }}
        busy={Boolean(pendingKey)} addTestId="cross-sell-product" onAdd={() => { void addProduct(product); }}
        onQuickReply={message => { if (!pendingRef.current) { setDismissed(true); void sendMessage(message); } }} />)}
    </div>
  </div>;
  const header = <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>VocÃƒÂª tambÃƒÂ©m pode gostar</h3>
    {mode !== "inline" ? <button data-neu="icon" type="button" aria-label="Fechar sugestÃƒÂµes" data-testid="cross-sell-dismiss"
      disabled={Boolean(pendingKey)} onClick={close} style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%",
        border: "1px solid var(--aacp-line)", background: "var(--aacp-surface)", color: "inherit", fontSize: 20 }}>Ãƒâ€”</button> : null}
  </header>;
  const alert = error ? <p role="alert" style={{ color: "var(--aacp-error, #ef4444)", fontSize: 13 }}>{error}</p> : null;
  if (mode === "modal") return <>
    <span ref={anchorRef} />
    {createPortal(<div ref={scopeRef} style={portalTheme}>
      <div role="presentation" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,.55)" }} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Complementos sugeridos" data-testid="cross-sell-modal" data-cross-sell
        style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 9999,
          width: "min(560px, calc(100vw - 32px))", maxHeight: "82dvh", overflow: "hidden", display: "flex", flexDirection: "column",
          padding: 18, boxSizing: "border-box", border: "1px solid var(--aacp-line)", borderRadius: 20,
          background: "var(--aacp-panel-bg, #edf0ee)", color: "var(--aacp-fg, #202b24)", fontFamily: "var(--aacp-font, inherit)", boxShadow: "0 20px 60px rgba(0,0,0,.4)" }}>
        <div style={{ flexShrink: 0 }}>{header}</div>
        <div style={{ minHeight: 0, overflowY: "auto" }}>{cards}</div>
        {alert}
        <button data-neu="control" type="button" data-testid="cross-sell-skip" onClick={close} disabled={Boolean(pendingKey)}
          style={{ flexShrink: 0, minHeight: 44, marginTop: 12, padding: 12, border: "1px solid var(--aacp-line)", borderRadius: 8,
            background: "var(--aacp-surface)", color: "inherit", font: "inherit", fontSize: 13 }}>Continuar sem adicionar</button>
      </div>
    </div>, document.body)}
  </>;
  return <section data-cross-sell data-testid={`cross-sell-${mode}`} className={catalogProductStyles.carousel}
    style={{ minWidth: 0, width: "100%", boxSizing: "border-box", border: "1px solid var(--aacp-line)", borderRadius: 14,
      background: "var(--aacp-surface, #edf0ee)", padding: 14 }}>
    {header}{cards}{alert}
    {mode === "interstitial" ? <button data-neu="control" type="button" data-testid="cross-sell-continue" disabled={Boolean(pendingKey)}
      onClick={() => { if (!pendingRef.current) { setDismissed(true); void sendMessage("Continuar"); } }}
      style={{ minHeight: 44, width: "100%", padding: 12, marginTop: 12, borderRadius: 8, border: "1px solid var(--aacp-line)",
        background: "var(--aacp-surface)", color: "inherit", font: "inherit", fontSize: 13 }}>Continuar</button> : null}
  </section>;
}


function CouponInputBlock({ data }: { data?: Record<string, unknown> }) {
  const applyCouponCode = useCheckoutStore((s) => s.applyCouponCode);
  const proceedToPayment = useCheckoutStore((s) => s.proceedToPayment);
  const cartDiscount = useCheckoutStore((s) => s.cart.discount);
  const cartTotal = useCheckoutStore((s) => s.cart.total);
  const maxDiscountPercent = useCheckoutStore((s) => s.maxDiscountPercent);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const advanced = useRef(false);

  const methods = data?.methods as Array<{ key: string; label: string; sub?: string }> | undefined;

  const currentDiscountPercent = cartTotal > 0 ? (cartDiscount / cartTotal) * 100 : 0;
  const atMaxDiscount = currentDiscountPercent >= maxDiscountPercent - 0.01;

  useEffect(() => {
    if (atMaxDiscount) advance();
  }, [atMaxDiscount]);

  if (atMaxDiscount || done) return null;

  function advance() {
    if (advanced.current) return;
    advanced.current = true;
    setDone(true);
    proceedToPayment(methods);
  }

  const handleApply = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError(null);
    const result = await applyCouponCode(code);
    setLoading(false);
    if (result.ok) {
      advance();
    } else {
      setError(result.error || "Cupom invÃƒÂ¡lido");
    }
  };

  return (
    <div data-neu="surface" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)", marginBottom: "8px" }}>Tem cupom de desconto?</div>
      <div style={{ display: "flex", gap: "6px" }}>
        <input data-neu="field"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="CÃƒÂ³digo do cupom"
          style={{
            flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: "8px",
            border: "1px solid var(--bd)", background: "var(--chip)",
            color: "var(--tx)", fontSize: "12px", fontFamily: "inherit", outline: "none",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleApply(); } }}
          disabled={loading}
        />
        <button data-neu="control"
          onClick={() => void handleApply()}
          disabled={!code.trim() || loading}
          style={{
            padding: "8px 14px", borderRadius: "8px", border: "none",
            background: code.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)",
            color: "#fff", fontSize: "12px", fontWeight: 600,
            cursor: code.trim() && !loading ? "pointer" : "not-allowed",
            flex: "none", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "..." : "Aplicar"}
        </button>
      </div>
      {error && <div style={{ fontSize: "11px", color: "#c92a2a", marginTop: "6px" }}>{error}</div>}
      <button data-neu="control"
        onClick={advance}
        disabled={loading}
        style={{
          marginTop: "8px", width: "100%", padding: "8px 12px", borderRadius: "8px",
          border: "1px solid var(--bd)", background: "transparent",
          color: "var(--mut)", fontSize: "12px", fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        NÃƒÂ£o possuo cupom
      </button>
    </div>
  );
}

function OfferCouponBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const code = (data.code as string) || "";
  const description = (data.description as string) || "";

  return (
    <div data-neu="surface" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--aacp-accent-text, var(--aacp-accent, #0f766e))" }}>Cupom disponivel</div>
      {description && <div style={{ fontSize: "12px", color: "var(--mut)", marginBottom: "6px" }}>{description}</div>}
      <button data-neu="primary"
        onClick={() => void sendMessage(`Aplicar cupom ${code}`)}
        style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
      >
        Aplicar {code}
      </button>
    </div>
  );
}

function AddressConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  if (!data) return null;
  const formatted = (data.formatted as string) || "";

  const handleYes = () => {
    void sendMessage("Sim");
  };

  const handleNo = () => {
    void sendMessage("NÃƒÂ£o");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {formatted && (
        <div data-neu="surface" style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", fontSize: "13px", color: "var(--tx)" }}>
          {formatted}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button data-neu="primary"
          onClick={handleYes}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "none",
            background: "var(--aacp-accent, #0f766e)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sim
        </button>
        <button data-neu="control"
          onClick={handleNo}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          NÃƒÂ£o
        </button>
      </div>
    </div>
  );
}

function FormFieldBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const completeFormField = useCheckoutStore((s) => s.completeFormField);
  const [value, setValue] = useState("");
  if (!data) return null;
  const field = typeof data.field === "string" ? data.field : "";
  const label = (data.label as string) || (data.field as string) || "";
  const placeholder = (data.placeholder as string) || "";
  const isCep = field === "cep";
  const normalizedValue = isCep ? value.replace(/\D/g, "") : value.trim();
  const canSubmit = isCep ? normalizedValue.length === 8 : normalizedValue.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      completeFormField(field);
      void sendMessage(normalizedValue);
      setValue("");
    }
  };

  const updateValue = (next: string) => {
    if (!isCep) {
      setValue(next);
      return;
    }
    const digits = next.replace(/\D/g, "").slice(0, 8);
    setValue(digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits);
  };

  return (
    <form data-neu="inset" data-aacp-inline-field={field || "text"} onSubmit={handleSubmit}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: "9px", padding: "9px 9px 9px 15px", background: "var(--aacp-inset-bg, var(--chip))", border: "1px solid var(--bd)", borderRadius: "14px", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }}
    >
      <PerimeterBorder radius="14px" variant="input" />
      <label style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
        {label}
      </label>
      <input data-neu="field"
        type="text"
        value={value}
        onChange={(e) => updateValue(e.target.value)}
        placeholder={placeholder}
        inputMode={isCep ? "numeric" : undefined}
        autoComplete={isCep ? "postal-code" : "off"}
        maxLength={isCep ? 9 : undefined}
        aria-label={label}
        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--tx)", fontSize: "13px", padding: 0, fontFamily: "inherit" }}
      />
      <button data-neu="send"
        type="submit"
        disabled={!canSubmit}
        aria-label={label ? `Enviar ${label}` : "Enviar"}
        style={{ width: "36px", height: "36px", borderRadius: "10px", border: "none", cursor: canSubmit ? "pointer" : "not-allowed", background: canSubmit ? "var(--aacp-accent, #0f766e)" : "var(--bd)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
    </form>
  );
}

function LeadCaptureBlock() {
  const buyer = useCheckoutStore((s) => s.buyer);
  const registerLead = useCheckoutStore((s) => s.registerLead);
  const [values, setValues] = useState({
    name: buyer.name ?? "",
    email: buyer.email ?? "",
    phone: buyer.phone ?? "",
    cpf: buyer.cpf ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const updateValue = (field: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim());
    const phoneDigits = values.phone.replace(/\D/g, "");
    const cpfDigits = values.cpf.replace(/\D/g, "");
    if (values.name.trim().length < 3 || !emailIsValid || phoneDigits.length < 10 || !isValidCpf(cpfDigits)) {
      setError("Confira nome, e-mail, telefone e CPF.");
      return;
    }

    setSaving(true);
    setError("");
    const result = await registerLead(values);
    setSaving(false);
    if (!result.ok) setError(result.error ?? "NÃƒÂ£o foi possÃƒÂ­vel salvar seus dados.");
  };

  return (
    <form data-testid="lead-capture" onSubmit={(event) => void handleSubmit(event)} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0, lineHeight: 1.45 }}>
        Seus dados identificam o pedido e registram seu atendimento.
      </p>
      <LeadInput label="Nome completo" value={values.name} onChange={(value) => updateValue("name", value)} autoComplete="name" />
      <LeadInput label="E-mail" type="email" value={values.email} onChange={(value) => updateValue("email", value)} autoComplete="email" />
      <LeadInput label="Telefone com DDD" type="tel" value={values.phone} onChange={(value) => updateValue("phone", value)} autoComplete="tel" inputMode="tel" />
      <LeadInput label="CPF" value={values.cpf} onChange={(value) => updateValue("cpf", value)} autoComplete="off" inputMode="numeric" />
      {error && <p role="alert" style={{ fontSize: "12px", color: "#c92a2a", margin: 0 }}>{error}</p>}
      <button data-neu="primary" type="submit" disabled={saving} style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "13px", fontWeight: 700, cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? "Salvando..." : "Continuar para pagamento"}
      </button>
    </form>
  );
}

function LeadInput({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
  autoComplete: string;
  inputMode?: "numeric" | "tel";
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>
      {label}
      <input data-neu="field" type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} inputMode={inputMode} required style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--bd)", background: "var(--chip)", color: "var(--tx)", fontSize: "13px", fontFamily: "inherit" }} />
    </label>
  );
}

function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (length: number) => {
    const sum = value.slice(0, length).split("").reduce((total, current, index) => total + Number(current) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

function CryptoPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const api = useCheckoutStore((s) => s.api);

  type CryptoStep = "idle" | "connected" | "sending" | "confirming" | "error";
  type CryptoTransfer = {
    destination: string;
    amountAtomic: string;
    amountDisplay: string;
  };
  const [step, setStep] = useState<CryptoStep>("idle");
  const [wallet, setWallet] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [rpcHelp, setRpcHelp] = useState<boolean>(false);
  const [submittedTxHashes, setSubmittedTxHashes] = useState<string[]>([]);
  const [partialSubmission, setPartialSubmission] = useState(false);

  useEffect(() => { pollPayment(); }, [pollPayment]);

  if (!data) return null;

  const intentId = String(data.intent_id || "");
  const chainLabel = String(data.crypto_chain_label || "Polygon");
  const network = String(data.crypto_network || "testnet");
  const tokenSymbol = String(data.crypto_token_symbol || "USDC");
  const amountDisplay = String(data.crypto_amount_display || "?.?? USDC");
  const amountAtomic = String(data.crypto_amount_atomic || "0");
  const destination = String(data.crypto_destination_address || "");
  const tokenAddress = String(data.crypto_token_address || "");
  const chainId = Number(data.crypto_chain_id || 80002);
  const rpcUrl = String(data.crypto_rpc_url || "");
  const blockExplorerUrl = String(data.crypto_block_explorer_url || "");
  const cryptoNativeCurrency = data.crypto_native_currency as { name: string; symbol: string; decimals: number } | undefined;
  const quotedTransfers = Array.isArray(data.crypto_transfers) ? data.crypto_transfers : [];
  const transfers: CryptoTransfer[] = quotedTransfers.length
    ? quotedTransfers.map((transfer) => {
      const raw = transfer as Record<string, unknown>;
      return {
        destination: String(raw.destination_address || ""),
        amountAtomic: String(raw.amount_atomic || ""),
        amountDisplay: String(raw.amount_display || ""),
      };
    })
    : [{ destination, amountAtomic, amountDisplay }];
  const transfersValid = transfers.length > 0 && transfers.every((transfer) => (
    /^0x[a-fA-F0-9]{40}$/.test(transfer.destination) &&
    /^\d+$/.test(transfer.amountAtomic) &&
    BigInt(transfer.amountAtomic) > 0n
  ));
  const requiredAtomic = transfersValid
    ? transfers.reduce((total, transfer) => total + BigInt(transfer.amountAtomic), 0n)
    : 0n;

  const chainIdHex = "0x" + chainId.toString(16);

  function encodeTransferData(to: string, value: string): string {
    const selector = "0xa9059cbb";
    const addrPadded = to.toLowerCase().replace("0x", "").padStart(64, "0");
    const valHex = BigInt(value).toString(16).padStart(64, "0");
    return selector + addrPadded + valHex;
  }

  async function alchemyRpc(method: string, params: unknown[]): Promise<string | null> {
    if (!rpcUrl) return null;
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = await res.json();
      return typeof json?.result === "string" ? json.result : null;
    } catch {
      return null;
    }
  }

  async function checkBalances(): Promise<string | null> {
    const balanceOfData = "0x70a08231" + wallet.toLowerCase().replace("0x", "").padStart(64, "0");
    const [tokenBalHex, nativeBalHex] = await Promise.all([
      alchemyRpc("eth_call", [{ to: tokenAddress, data: balanceOfData }, "latest"]),
      alchemyRpc("eth_getBalance", [wallet, "latest"]),
    ]);
    if (tokenBalHex === null && nativeBalHex === null) return null;
    const tokenBal = BigInt(tokenBalHex || "0x0");
    const nativeBal = BigInt(nativeBalHex || "0x0");
    const required = requiredAtomic;
    if (tokenBalHex !== null && tokenBal < required) {
      return `Saldo de ${tokenSymbol} insuficiente. VocÃƒÂª precisa de ${amountDisplay}.`;
    }
    if (nativeBalHex !== null && nativeBal === 0n) {
      const gasSymbol = cryptoNativeCurrency?.symbol || "ETH";
      return `Sem ${gasSymbol} para taxa de rede (gas). Adicione ${gasSymbol} via faucet e tente novamente.`;
    }
    return null;
  }

  const handleConnect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setError("no_metamask");
      return;
    }
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      if (accounts[0]) {
        setWallet(accounts[0]);
        setStep("connected");
        setError("");
      }
    } catch {
      setError("ConexÃƒÂ£o rejeitada");
    }
  };

  async function confirmSubmittedTransfers(txHashes: string[]) {
    if (!api || !api.currentSessionId) throw new Error("checkout_session_not_started");
    if (!intentId || txHashes.length !== transfers.length) throw new Error("crypto_transfers_incomplete");
    const result = await confirmCryptoPayment(api, {
      paymentIntentId: intentId,
      sessionId: api.currentSessionId,
      txHash: txHashes[0]!,
      txHashes,
      walletAddress: wallet,
    });
    if (!result.ok) throw new Error(`crypto_confirm_failed: ${result.status}`);
    pollPayment();
  }

  const handleVerifySubmitted = async () => {
    if (submittedTxHashes.length !== transfers.length) return;
    setStep("confirming");
    setError("");
    try {
      await confirmSubmittedTransfers(submittedTxHashes);
    } catch {
      setError("As transferÃƒÂªncias jÃƒÂ¡ foram enviadas. Aguarde a rede e use Verificar pagamento; nÃƒÂ£o pague novamente.");
      setStep("connected");
    }
  };

  const switchOrAddChain = async (eth: any) => {
    const nativeCur = cryptoNativeCurrency || { name: "ETH", symbol: "ETH", decimals: 18 };
    const chainParams = {
      chainId: chainIdHex,
      chainName: `${chainLabel} ${network}`,
      nativeCurrency: nativeCur,
      rpcUrls: [rpcUrl || `https://sepolia.base.org`],
      blockExplorerUrls: [blockExplorerUrl || `https://sepolia.basescan.org`],
    };
    const isRateLimitOrRpc = (err: any) => {
      const msg = String(err?.message || "").toLowerCase();
      return msg.includes("rate limit") || msg.includes("429") || msg.includes("getblockbynumber") || msg.includes("timeout");
    };
    try {
      await eth.request({ method: "wallet_addEthereumChain", params: [chainParams] });
    } catch (addErr: any) {
      if (addErr?.code === 4001) throw addErr;
      if (isRateLimitOrRpc(addErr)) return;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
      } catch (switchErr: any) {
        if (switchErr?.code === 4001) throw switchErr;
        if (switchErr?.code === 4902) {
          await eth.request({ method: "wallet_addEthereumChain", params: [chainParams] });
        } else if (isRateLimitOrRpc(switchErr)) {
          return;
        } else {
          throw switchErr;
        }
      }
    }
  };

  const handlePay = async () => {
    const eth = (window as any).ethereum;
    if (!eth || !wallet || !transfersValid || partialSubmission || submittedTxHashes.length) return;
    setStep("sending");
    setError("");
    setRpcHelp(false);
    const txHashes: string[] = [];
    let allTransfersSubmitted = false;
    try {
      const currentChainId: string = await eth.request({ method: "eth_chainId" });
      console.log("[CRYPTO-PAY] chainId current=%s target=%s rpcUrl=%s", currentChainId, chainIdHex, rpcUrl);
      if (currentChainId.toLowerCase() !== chainIdHex.toLowerCase()) {
        console.log("[CRYPTO-PAY] switching chain...");
        await switchOrAddChain(eth);
      }

      const balanceError = await checkBalances();
      console.log("[CRYPTO-PAY] balance check:", balanceError ?? "OK");
      if (balanceError) {
        setError(balanceError);
        setStep("connected");
        return;
      }

      if (!transfersValid) {
        setError("Valor do pagamento invÃƒÂ¡lido. Recarregue e tente novamente.");
        setStep("connected");
        return;
      }

      const gasPrice = await alchemyRpc("eth_gasPrice", []);
      for (const transfer of transfers) {
        const calldata = encodeTransferData(transfer.destination, transfer.amountAtomic);
        const txParams: Record<string, string> = {
          from: wallet,
          to: tokenAddress,
          data: calldata,
          gas: "0x186A0",
        };
        if (gasPrice) txParams.gasPrice = gasPrice;
        // Leave nonce assignment to the wallet. Reusing a pending nonce for
        // the platform split would replace the merchant transfer.
        const txHash: string = await eth.request({
          method: "eth_sendTransaction",
          params: [txParams],
        });
        txHashes.push(txHash);
        setSubmittedTxHashes([...txHashes]);
      }
      allTransfersSubmitted = true;

      setStep("confirming");
      await confirmSubmittedTransfers(txHashes);
    } catch (e: any) {
      console.error("[CRYPTO-PAY] ERROR:", e?.code, e?.message, e);
      if (txHashes.length && !allTransfersSubmitted) {
        setPartialSubmission(true);
        setError("Uma transferÃƒÂªncia jÃƒÂ¡ foi enviada, mas o pagamento nÃƒÂ£o foi concluÃƒÂ­do. NÃƒÂ£o pague novamente; contate o suporte com o hash da transaÃƒÂ§ÃƒÂ£o.");
        setStep("error");
        return;
      }
      if (allTransfersSubmitted) {
        setError("As transferÃƒÂªncias jÃƒÂ¡ foram enviadas. Aguarde a rede e use Verificar pagamento; nÃƒÂ£o pague novamente.");
        setStep("connected");
        return;
      }
      if (e?.code === 4001) {
        setError("TransaÃƒÂ§ÃƒÂ£o cancelada");
        setStep("connected");
      } else {
        const msg = String(e?.message || "").toLowerCase();
        if (msg.includes("rate limit") || msg.includes("getblockbynumber") || msg.includes("sendrawtransaction")) {
          setRpcHelp(true);
          setError("O RPC da sua carteira estÃƒÂ¡ sobrecarregado. Atualize o endereÃƒÂ§o RPC da rede (instruÃƒÂ§ÃƒÂµes abaixo) e tente novamente.");
        } else if (msg.includes("insufficient funds") || msg.includes("client error") || msg.includes("http")) {
          const gasSymbol = cryptoNativeCurrency?.symbol || "ETH";
          setError(`Falha ao enviar. Verifique se tem ${tokenSymbol} suficiente e ${gasSymbol} para gas.`);
        } else {
          setError(e?.message || "Erro ao enviar transaÃƒÂ§ÃƒÂ£o");
        }
        setStep("connected");
      }
    }
  };

  const btnBase: React.CSSProperties = {
    padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)",
    color: "#fff", border: "none", fontSize: "13px", fontWeight: 600,
    fontFamily: "var(--aacp-font, inherit)", cursor: "pointer", width: "100%",
  };

  if (error === "no_metamask") {
    return (
      <div data-neu="surface" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
        <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px" }}>Instale MetaMask para pagar com crypto</p>
        <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: "12px", color: "var(--aacp-accent-text, var(--aacp-accent, #0f766e))", textDecoration: "underline" }}>
          Baixar MetaMask
        </a>
      </div>
    );
  }

  return (
    <div data-neu="surface" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
        Pague com {tokenSymbol} ({chainLabel} {network !== "mainnet" ? network : ""})
      </div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 10px", lineHeight: 1.4 }}>
        <strong>{amountDisplay}</strong>
      </p>
      {transfers.length > 1 && (
        <p style={{ fontSize: "11px", color: "var(--mut)", margin: "0 0 10px", lineHeight: 1.4 }}>
          Sua carteira solicitarÃƒÂ¡ {transfers.length} confirmaÃƒÂ§ÃƒÂµes para concluir este pagamento.
        </p>
      )}
      {!transfersValid && (
        <div style={{ padding: "6px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginBottom: "8px" }}>
          A cotaÃƒÂ§ÃƒÂ£o cripto estÃƒÂ¡ incompleta. Gere um novo pagamento antes de transferir.
        </div>
      )}

      {step === "idle" && transfersValid && (
        <button data-neu="primary" onClick={handleConnect} style={btnBase}>Conectar carteira</button>
      )}

      {step === "connected" && (
        <>
          <div style={{ fontSize: "11px", color: "var(--mut)", marginBottom: "8px", wordBreak: "break-all" }}>
            Carteira: {wallet.slice(0, 6)}...{wallet.slice(-4)}
          </div>
          {partialSubmission ? (
            <div style={{ padding: "6px 10px", borderRadius: "6px", background: "#fff4e5", color: "#8a4b08", fontSize: "12px" }}>
              HÃƒÂ¡ uma transferÃƒÂªncia parcial. NÃƒÂ£o envie novos valores; contate o suporte com o hash da transaÃƒÂ§ÃƒÂ£o.
            </div>
          ) : submittedTxHashes.length ? (
            <button data-neu="primary" onClick={handleVerifySubmitted} style={btnBase}>Verificar pagamento</button>
          ) : (
            <button data-neu="primary" onClick={handlePay} style={btnBase}>Pagar {amountDisplay}</button>
          )}
        </>
      )}

      {step === "sending" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px 0" }}>
          <PulseAgentOrb placement="chatLoading" active />
          <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Confirme no MetaMask...</p>
        </div>
      )}

      {step === "confirming" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "8px 0" }}>
          <PulseAgentOrb placement="chatLoading" active />
          <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>TransaÃƒÂ§ÃƒÂ£o enviada! Verificando on-chain...</p>
        </div>
      )}

      {error && error !== "no_metamask" && (
        <div style={{ padding: "6px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginTop: "8px" }}>
          {error}
        </div>
      )}
      {rpcHelp && rpcUrl && (
        <div data-neu="surface" style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", border: "1px solid var(--bd)", fontSize: "12px", color: "var(--tx)", marginTop: "8px", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: "6px" }}>Como corrigir (1 min):</div>
          <ol style={{ margin: "0 0 8px", paddingLeft: "18px" }}>
            <li>Abra o MetaMask Ã¢â€ â€™ ConfiguraÃƒÂ§ÃƒÂµes Ã¢â€ â€™ Redes Ã¢â€ â€™ {chainLabel} {network}</li>
            <li>Substitua a URL do RPC pela abaixo e salve</li>
            <li>Volte aqui e toque em Pagar novamente</li>
          </ol>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <code style={{ flex: 1, minWidth: 0, background: "var(--card)", padding: "6px 8px", borderRadius: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" }}>
              {rpcUrl}
            </code>
            <button data-neu="primary"
              onClick={() => { void navigator.clipboard?.writeText(rpcUrl); }}
              style={{ padding: "6px 10px", borderRadius: "6px", border: "none", background: "var(--aacp-accent, #0f766e)", color: "#fff", fontSize: "11px", fontWeight: 600, cursor: "pointer", flex: "none" }}
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CryptoChainSelectBlock({ data }: { data?: Record<string, unknown> }) {
  const selectCryptoChain = useCheckoutStore((s) => s.selectCryptoChain);
  const [pending, setPending] = useState<string | null>(null);
  const rawChains = (data?.chains as string[] | undefined) ?? ["polygon", "base"];
  const labels: Record<string, string> = { polygon: "Polygon", base: "Base" };
  const chains = rawChains.filter((c): c is "polygon" | "base" => c === "polygon" || c === "base");

  const handleSelect = (chain: "polygon" | "base") => {
    if (pending) return;
    setPending(chain);
    void selectCryptoChain(chain);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Rede:</div>
      {chains.map((chain) => (
        <button data-neu="control"
          key={chain}
          onClick={() => handleSelect(chain)}
          disabled={!!pending}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid var(--bd)",
            background: "var(--chip)",
            color: "var(--tx)",
            cursor: pending ? "default" : "pointer",
            textAlign: "left",
            fontSize: "13px",
            opacity: pending && pending !== chain ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!pending) e.currentTarget.style.borderColor = "var(--aacp-accent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--bd)";
          }}
        >
          <span style={{ fontWeight: 600 }}>{labels[chain] ?? chain}</span>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "6px",
              background: "var(--aacp-accent)",
              color: "#fff",
            }}
          >
            USDC
          </span>
        </button>
      ))}
    </div>
  );
}

export function BlockRenderer({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "checkout_price_review":
      return <CheckoutPriceReviewBlock fingerprint={block.data?.fingerprint} />;
    case "checkout_help":
      return <CheckoutHelpBlock data={block.data} />;
    case "checkout_alternatives":
      return <CheckoutAlternativesBlock data={block.data} />;
    case "text":
    case "message":
      return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data?.content || block.text || "")}</p>;
    case "cart_summary":
      return <CartSummaryBlock data={block.data} />;
    case "address_confirmation":
      return <AddressConfirmationBlock data={block.data} />;
    case "shipping_options":
      return <ShippingOptionsBlock options={block.data?.options} selectionMode={block.data?.selection_mode} />;
    case "coupon_input":
      return <CouponInputBlock data={block.data} />;
    case "payment_methods":
      return <PaymentMethodsBlock methods={block.data?.methods} />;
    case "pix_payment":
      return <PixPaymentBlock data={block.data} />;
    case "hosted_card_payment":
      return <BoletoPaymentBlock data={{ ...block.data, hosted_card: true }} />;
    case "boleto_payment":
      return <BoletoPaymentBlock data={block.data} />;
    case "crypto_chain_select":
      return <CryptoChainSelectBlock data={block.data} />;
    case "crypto_payment":
      return <CryptoPaymentBlock data={block.data} />;
    case "stripe_card":
      return <StripeCardBlock data={block.data} />;
    case "order_confirmation":
      return <OrderConfirmationBlock data={block.data} />;
    case "order_summary":
      return <CartSummaryBlock data={block.data} />;
    case "cross_sell":
      return <CrossSellBlock data={block.data} />;
    case "offer_coupon":
      return <OfferCouponBlock data={block.data} />;
    case "form_field":
      return <FormFieldBlock data={block.data} />;
    case "lead_capture":
      return <LeadCaptureBlock />;
    default:
      if (block.text) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{block.text}</p>;
      if (block.data?.text || block.data?.content) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data.text || block.data.content)}</p>;
      return null;
  }
}
