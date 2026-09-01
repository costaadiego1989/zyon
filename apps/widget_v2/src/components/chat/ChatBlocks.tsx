import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useCheckoutStore } from "@/store/checkout-store";
import { confirmCryptoPayment } from "@/api/payment";
import { PulseAgentOrb } from "../PulseAgentOrb";
import type { ChatBlock } from "@/api/checkout-session";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { trackEvent } from "@/lib/tracking";
import { translateShippingLabel } from "./helpers";

function CartSummaryBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  const items = (data.items as Array<{ name: string; qty?: number; quantity?: number; total?: string; price?: number }>) ?? [];
  const total = data.total as number | undefined;
  const discount = data.discount as number | undefined;

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Resumo do carrinho</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--mut)", padding: "4px 0" }}>
          <span>{item.name} x{item.qty ?? item.quantity ?? 1}</span>
          <span>{item.total ?? (item.price != null ? formatPrice(item.price) : "")}</span>
        </div>
      ))}
      {discount != null && discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--aacp-accent, #0f766e)", padding: "4px 0" }}>
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

function ShippingOptionsBlock({ options }: { options?: unknown }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const selectShipping = useCheckoutStore((s) => s.selectShipping);
  const opts = ((options as Array<{ key: string; label: string; tag?: string; sub?: string; cost?: number }>) ?? [])
    .filter((o) => o && o.key && o.label);

  const handleSelect = async (opt: (typeof opts)[0]) => {
    await selectShipping(opt.key);
    void sendMessage(`Entrega · ${translateShippingLabel(opt.label)}`);
  };

  const formatPrice = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Escolha o frete:</div>
      {opts.map((opt) => (
        <button
          key={opt.key}
          onClick={() => void handleSelect(opt)}
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
          <div style={{ fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{translateShippingLabel(opt.label)}</span>
            <span style={{ fontSize: "12px", color: "var(--aacp-accent, #0f766e)" }}>
              {opt.cost === 0 ? "Grátis" : opt.cost != null ? formatPrice(opt.cost / 100) : ""}
            </span>
          </div>
          {opt.sub && <div style={{ fontSize: "11px", color: "var(--mut)", marginTop: "2px" }}>{opt.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PaymentMethodsBlock({ methods }: { methods?: unknown }) {
  const pay = useCheckoutStore((s) => s.pay);
  const meths = (methods as Array<{ key: string; label: string; sub?: string }>) ?? [];

  const handleSelect = (method: (typeof meths)[0]) => {
    void pay(method.key as "pix" | "credito" | "debito" | "crypto");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>Forma de pagamento:</div>
      {meths.map((m) => (
        <button
          key={m.key}
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
          <div style={{ fontWeight: 600 }}>{m.label}</div>
          {m.sub && <div style={{ fontSize: "11px", color: "var(--mut)" }}>{m.sub}</div>}
        </button>
      ))}
    </div>
  );
}

function PixPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const stopPolling = useCheckoutStore((s) => s.stopPolling);
  const status = useCheckoutStore((s) => s.status);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    pollPayment();
    return () => stopPolling();
  }, [pollPayment, stopPolling]);

  if (!data) return null;

  if (status === "completed") {
    return (
      <div style={{ padding: "16px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)", textAlign: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
          <div style={{ fontSize: "32px" }}>✓</div>
          <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--tx)" }}>Pagamento confirmado! 🎉</div>
          <p style={{ fontSize: "13px", color: "var(--mut)", margin: 0 }}>Seu pedido está sendo processado.</p>
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    const code = String(data.pix_code ?? "");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>Pague com Pix</div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px", lineHeight: 1.4 }}>
        Escaneie o QR Code no app do seu banco. Pedido confirmado assim que o pagamento cai.
      </p>
      {data.pix_qr_url ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "10px" }}>
          <img src={String(data.pix_qr_url)} alt="QR Code Pix" style={{ width: "160px", height: "160px", borderRadius: "8px" }} />
        </div>
      ) : null}
      {data.pix_code != null && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          <code style={{ flex: 1, minWidth: 0, background: "var(--chip, var(--card))", padding: "8px 10px", borderRadius: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", fontFamily: "var(--aacp-font, inherit)" }}>
            {String(data.pix_code).slice(0, 50)}...
          </code>
          <button
            onClick={handleCopy}
            style={{ padding: "8px 14px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", fontSize: "13px", fontWeight: 600, fontFamily: "var(--aacp-font, inherit)", cursor: "pointer", flex: "none", transition: "opacity 0.2s" }}
          >
            {copied ? "✓ Copiado" : "Copiar Pix"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px" }}>
        <PulseAgentOrb placement="chatLoading" active />
        <p style={{ fontSize: "13px", color: "var(--mut)", margin: 0, textAlign: "center" }}>
          Aguardando pagamento...
        </p>
      </div>
    </div>
  );
}

function StripeCardBlockForm({
  clientSecret,
  intentId
}: {
  clientSecret: string;
  intentId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = useCheckoutStore((s) => s.api);
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const brand = useCheckoutStore((s) => s.brand);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!stripe || !elements) {
      setError("Stripe não carregou corretamente");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const existing = await stripe.retrievePaymentIntent(clientSecret);
      if (existing.paymentIntent?.status === "succeeded") {
        if (api) {
          try { await api.confirmStripePayment(intentId); } catch {}
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
        setLoading(false);
        return;
      }

      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "requires_action") {
        let approved = false;
        if (api) {
          try {
            const res = await api.confirmStripePayment(intentId);
            approved = (res as { status?: string })?.status === "approved";
          } catch (confirmErr) {
            console.error("Server confirm failed:", confirmErr);
          }
        }
        if (approved || paymentIntent.status === "succeeded") {
          useCheckoutStore.setState((s) => ({
            status: "completed",
            cart: { ...s.cart, status: "paid" },
          }));
          void trackEvent("order_completed", { intent_id: intentId });
        } else {
          pollPayment();
        }
      } else {
        setError(`Payment failed: ${paymentIntent?.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: "12px" }}>
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
        <div style={{ padding: "8px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginBottom: "12px" }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || loading}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: "8px",
          background: loading || !stripe ? "var(--bd)" : "var(--aacp-accent, #0f766e)",
          color: "#fff",
          border: "none",
          fontSize: "13px",
          fontWeight: 600,
          fontFamily: "var(--aacp-font, inherit)",
          cursor: loading || !stripe ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Processando..." : "Pagar"}
      </button>
    </form>
  );
}

const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function getStripePromise(publishableKey: string) {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

function StripeCardBlock({ data }: { data?: Record<string, unknown> }) {
  const clientSecret = data?.stripe_client_secret as string | undefined;
  const publishableKey = data?.stripe_publishable_key as string | undefined;
  const intentId = data?.intent_id as string | undefined;

  if (!clientSecret || !publishableKey || !intentId) {
    return (
      <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
        <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Erro: dados de pagamento incompletos</p>
      </div>
    );
  }

  const stripePromise = getStripePromise(publishableKey);
  const elementsOptions = useMemo(() => ({ clientSecret }), [clientSecret]);

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>Pague com Cartão de Crédito</div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 12px", lineHeight: 1.4 }}>
        Seus dados do cartão são seguros e encriptados.
      </p>
      <Elements stripe={stripePromise} options={elementsOptions}>
        <StripeCardBlockForm clientSecret={clientSecret} intentId={intentId} />
      </Elements>
    </div>
  );
}

function OrderConfirmationBlock({ data }: { data?: Record<string, unknown> }) {
  if (!data) return null;
  return (
    <div style={{ padding: "16px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
        <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
          <PulseAgentOrb placement="chatBubble" active />
        </div>
      </div>
      <div style={{ fontSize: "28px", marginBottom: "6px" }}>✓</div>
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

type CrossSellProduct = { name: string; price?: number; image?: string; sku?: string; variantId?: string; inStock?: boolean };

const formatCrossSellPrice = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
function CrossSellBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [dismissed, setDismissed] = useState(false);

  const products = (data?.products as CrossSellProduct[]) ?? [];
  const mode = (data?.displayMode as string) ?? "inline";

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setDismissed(true);
  }, []);

  useEffect(() => {
    if (mode !== "modal" || dismissed) return;
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [mode, dismissed, handleEsc]);

  if (!data || products.length === 0 || dismissed) return null;

  const addButton = (p: CrossSellProduct, i: number, compact = false) => (
    <button
      key={i}
      data-testid="cross-sell-product"
      onClick={() => void sendMessage(`Adicionar ${p.name}`)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: compact ? "auto" : "100%",
        gap: compact ? "8px" : undefined,
        padding: "8px 10px",
        borderRadius: "8px",
        border: "1px solid var(--bd)",
        background: "transparent",
        color: "var(--tx)",
        cursor: "pointer",
        fontSize: "12px",
        marginBottom: compact ? 0 : "6px",
        textAlign: "left",
        flexShrink: 0,
      }}
    >
      <span>{p.name}</span>
      {p.price != null && (
        <span style={{ color: "var(--aacp-accent, #0f766e)", fontWeight: 600 }}>
          {formatCrossSellPrice(p.price)}
        </span>
      )}
    </button>
  );

  if (mode === "modal") {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Complementos sugeridos"
        data-testid="cross-sell-modal"
        onClick={(e) => { if (e.target === e.currentTarget) setDismissed(true); }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--bd)",
            borderRadius: "14px",
            padding: "18px",
            maxWidth: "420px",
            width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "12px" }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--mut)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Antes de pagar</div>
              <div style={{ fontSize: "15px", fontWeight: 700 }}>Você também pode gostar</div>
            </div>
            <button
              type="button"
              aria-label="Fechar sugestões"
              data-testid="cross-sell-dismiss"
              onClick={() => setDismissed(true)}
              style={{ background: "transparent", border: "none", color: "var(--mut)", cursor: "pointer", fontSize: "18px", lineHeight: 1 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {products.map((p, i) => addButton(p, i))}
          </div>
          <button
            type="button"
            data-testid="cross-sell-skip"
            onClick={() => setDismissed(true)}
            style={{ marginTop: "12px", width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--bd)", background: "transparent", color: "var(--mut)", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
          >
            Continuar sem adicionar →
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  if (mode === "banner") {
    return (
      <div
        data-testid="cross-sell-banner"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "var(--card)",
          border: "1px solid var(--bd)",
          borderRadius: "10px",
          padding: "10px 12px",
          marginBottom: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>Você também pode gostar:</span>
          <button
            type="button"
            aria-label="Fechar sugestões"
            data-testid="cross-sell-dismiss"
            onClick={() => setDismissed(true)}
            style={{ background: "transparent", border: "none", color: "var(--mut)", cursor: "pointer", fontSize: "16px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", scrollbarWidth: "none" }}>
          {products.map((p, i) => addButton(p, i, true))}
        </div>
      </div>
    );
  }

  if (mode === "interstitial") {
    const advanceToPayment = () => {
      setDismissed(true);
      void sendMessage("Continuar");
    };
    return (
      <div
        data-testid="cross-sell-interstitial"
        style={{
          width: "100%",
          background: "var(--card)",
          border: "1px solid var(--bd)",
          borderRadius: "14px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <style>{`.cs-scroll::-webkit-scrollbar { display: none; }`}</style>
        <div style={{ padding: "12px 14px 10px", display: "flex", alignItems: "center", gap: "9px" }}>
          <span aria-hidden style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "13.5px", fontWeight: 700, color: "var(--tx)", lineHeight: 1.3 }}>Complete seu pedido</p>
            <p style={{ margin: "1px 0 0", fontSize: "11.5px", fontWeight: 500, color: "var(--mut)", lineHeight: 1.3 }}>Aproveite e leve junto:</p>
          </div>
        </div>
        <div className="cs-scroll" style={{ display: "flex", gap: "10px", padding: "0 14px 14px", overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", scrollSnapType: "x mandatory", scrollbarWidth: "none" }}>
          {products.map((p, i) => (
            <div key={i} style={{ minWidth: "140px", maxWidth: "140px", flexShrink: 0, scrollSnapAlign: "start", background: "var(--tile2, var(--chip, rgba(255,255,255,0.04)))", border: "1px solid var(--bd)", borderRadius: "10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ width: "100%", height: "80px", background: "var(--tile1, var(--card))", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                {p.image ? (
                  <img src={p.image} alt={p.name} loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : (
                  <span style={{ fontSize: "30px", fontWeight: 800, color: "var(--aacp-accent, #0f766e)", opacity: 0.22 }}>{p.name.charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</span>
                {p.price != null && <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--aacp-accent, #0f766e)" }}>{formatCrossSellPrice(p.price)}</span>}
                <button
                  type="button"
                  data-testid="cross-sell-product"
                  disabled={p.inStock === false}
                  onClick={() => {
                    const ref = p.sku ? `${p.name} (SKU: ${p.sku})` : p.name;
                    void sendMessage(`Adicionar ${ref} ao carrinho`);
                    setDismissed(true);
                  }}
                  style={{ marginTop: "auto", width: "100%", padding: "9px 8px", borderRadius: "8px", border: "none", background: p.inStock === false ? "var(--bd)" : "var(--aacp-accent, #0f766e)", color: "#fff", fontSize: "12px", fontWeight: 800, cursor: p.inStock === false ? "not-allowed" : "pointer", opacity: p.inStock === false ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {p.inStock === false ? "Indisponível" : "Adicionar"}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--bd)" }}>
          <button type="button" data-testid="cross-sell-continue" onClick={advanceToPayment} style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid var(--bd)", background: "transparent", color: "var(--tx)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
            Continuar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="cross-sell-inline" style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>Você também pode gostar:</div>
      {products.map((p, i) => addButton(p, i))}
    </div>
  );
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

  const methods = data?.methods as Array<{ key: string; label: string; sub?: string }> | undefined;

  const currentDiscountPercent = cartTotal > 0 ? (cartDiscount / cartTotal) * 100 : 0;
  const atMaxDiscount = currentDiscountPercent >= maxDiscountPercent - 0.01;

  useEffect(() => {
    if (atMaxDiscount && !done) {
      setDone(true);
      proceedToPayment(methods);
    }
  }, [atMaxDiscount]);

  if (atMaxDiscount || done) return null;

  const advance = () => {
    setDone(true);
    proceedToPayment(methods);
  };

  const handleApply = async () => {
    if (!code.trim() || loading) return;
    setLoading(true);
    setError(null);
    const result = await applyCouponCode(code);
    setLoading(false);
    if (result.ok) {
      advance();
    } else {
      setError(result.error || "Cupom inválido");
    }
  };

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)", marginBottom: "8px" }}>Tem cupom de desconto?</div>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Código do cupom"
          style={{
            flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: "8px",
            border: "1px solid var(--bd)", background: "var(--chip)",
            color: "var(--tx)", fontSize: "12px", fontFamily: "inherit", outline: "none",
            textTransform: "uppercase", letterSpacing: "0.5px",
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleApply(); } }}
          disabled={loading}
        />
        <button
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
      <button
        onClick={advance}
        disabled={loading}
        style={{
          marginTop: "8px", width: "100%", padding: "8px 12px", borderRadius: "8px",
          border: "1px solid var(--bd)", background: "transparent",
          color: "var(--mut)", fontSize: "12px", fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        Não possuo cupom
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
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--aacp-accent, #0f766e)" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px", color: "var(--aacp-accent, #0f766e)" }}>Cupom disponivel</div>
      {description && <div style={{ fontSize: "12px", color: "var(--mut)", marginBottom: "6px" }}>{description}</div>}
      <button
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
    void sendMessage("Não");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {formatted && (
        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", fontSize: "13px", color: "var(--tx)" }}>
          {formatted}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
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
        <button
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
          Não
        </button>
      </div>
    </div>
  );
}

function FormFieldBlock({ data }: { data?: Record<string, unknown> }) {
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const [value, setValue] = useState("");
  if (!data) return null;
  const label = (data.label as string) || (data.field as string) || "";
  const placeholder = (data.placeholder as string) || "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      void sendMessage(value.trim());
      setValue("");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {label && <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--tx)" }}>{label}</label>}
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--bd)", background: "var(--chip)", color: "var(--tx)", fontSize: "13px", fontFamily: "inherit" }}
        />
        <button
          type="submit"
          disabled={!value.trim()}
          style={{ padding: "8px 12px", borderRadius: "8px", background: value.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: value.trim() ? "pointer" : "not-allowed" }}
        >
          Enviar
        </button>
      </div>
    </form>
  );
}

function CryptoPaymentBlock({ data }: { data?: Record<string, unknown> }) {
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const api = useCheckoutStore((s) => s.api);

  type CryptoStep = "idle" | "connected" | "sending" | "confirming" | "error";
  const [step, setStep] = useState<CryptoStep>("idle");
  const [wallet, setWallet] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [rpcHelp, setRpcHelp] = useState<boolean>(false);

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
    const required = BigInt(amountAtomic);
    if (tokenBalHex !== null && tokenBal < required) {
      return `Saldo de ${tokenSymbol} insuficiente. Você precisa de ${amountDisplay}.`;
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
      setError("Conexão rejeitada");
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
    if (!eth || !wallet) return;
    setStep("sending");
    setError("");
    setRpcHelp(false);
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

      if (!amountAtomic || BigInt(amountAtomic) === 0n) {
        setError("Valor do pagamento inválido. Recarregue e tente novamente.");
        setStep("connected");
        return;
      }

      const calldata = encodeTransferData(destination, amountAtomic);
      const [nonce, gasPrice] = await Promise.all([
        alchemyRpc("eth_getTransactionCount", [wallet, "pending"]),
        alchemyRpc("eth_gasPrice", []),
      ]);
      console.log("[CRYPTO-PAY] nonce=%s gasPrice=%s", nonce, gasPrice);
      const txParams: Record<string, string> = {
        from: wallet,
        to: tokenAddress,
        data: calldata,
        gas: "0x186A0",
      };
      if (nonce) txParams.nonce = nonce;
      if (gasPrice) txParams.gasPrice = gasPrice;
      console.log("[CRYPTO-PAY] sending tx:", txParams);
      const txHash: string = await eth.request({
        method: "eth_sendTransaction",
        params: [txParams],
      });
      console.log("[CRYPTO-PAY] tx sent:", txHash);

      setStep("confirming");
      if (api && api.currentSessionId) {
        await confirmCryptoPayment(api, {
          paymentIntentId: intentId,
          sessionId: api.currentSessionId,
          txHash: txHash,
          walletAddress: wallet,
        });
      }
      pollPayment();
    } catch (e: any) {
      console.error("[CRYPTO-PAY] ERROR:", e?.code, e?.message, e);
      if (e?.code === 4001) {
        setError("Transação cancelada");
        setStep("connected");
      } else {
        const msg = String(e?.message || "").toLowerCase();
        if (msg.includes("rate limit") || msg.includes("getblockbynumber") || msg.includes("sendrawtransaction")) {
          setRpcHelp(true);
          setError("O RPC da sua carteira está sobrecarregado. Atualize o endereço RPC da rede (instruções abaixo) e tente novamente.");
        } else if (msg.includes("insufficient funds") || msg.includes("client error") || msg.includes("http")) {
          const gasSymbol = cryptoNativeCurrency?.symbol || "ETH";
          setError(`Falha ao enviar. Verifique se tem ${tokenSymbol} suficiente e ${gasSymbol} para gas.`);
        } else {
          setError(e?.message || "Erro ao enviar transação");
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
      <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
        <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 8px" }}>Instale MetaMask para pagar com crypto</p>
        <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: "12px", color: "var(--aacp-accent, #0f766e)", textDecoration: "underline" }}>
          Baixar MetaMask
        </a>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "var(--card)", border: "1px solid var(--bd)" }}>
      <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>
        Pague com {tokenSymbol} ({chainLabel} {network !== "mainnet" ? network : ""})
      </div>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: "0 0 10px", lineHeight: 1.4 }}>
        <strong>{amountDisplay}</strong>
      </p>

      {step === "idle" && (
        <button onClick={handleConnect} style={btnBase}>Conectar carteira</button>
      )}

      {step === "connected" && (
        <>
          <div style={{ fontSize: "11px", color: "var(--mut)", marginBottom: "8px", wordBreak: "break-all" }}>
            Carteira: {wallet.slice(0, 6)}...{wallet.slice(-4)}
          </div>
          <button onClick={handlePay} style={btnBase}>Pagar {amountDisplay}</button>
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
          <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0 }}>Transação enviada! Verificando on-chain...</p>
        </div>
      )}

      {error && error !== "no_metamask" && (
        <div style={{ padding: "6px 10px", borderRadius: "6px", background: "#fee", color: "#c92a2a", fontSize: "12px", marginTop: "8px" }}>
          {error}
        </div>
      )}
      {rpcHelp && rpcUrl && (
        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "var(--chip)", border: "1px solid var(--bd)", fontSize: "12px", color: "var(--tx)", marginTop: "8px", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: "6px" }}>Como corrigir (1 min):</div>
          <ol style={{ margin: "0 0 8px", paddingLeft: "18px" }}>
            <li>Abra o MetaMask → Configurações → Redes → {chainLabel} {network}</li>
            <li>Substitua a URL do RPC pela abaixo e salve</li>
            <li>Volte aqui e toque em Pagar novamente</li>
          </ol>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <code style={{ flex: 1, minWidth: 0, background: "var(--card)", padding: "6px 8px", borderRadius: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" }}>
              {rpcUrl}
            </code>
            <button
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
        <button
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
    case "text":
    case "message":
      return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data?.content || block.text || "")}</p>;
    case "cart_summary":
      return <CartSummaryBlock data={block.data} />;
    case "address_confirmation":
      return <AddressConfirmationBlock data={block.data} />;
    case "shipping_options":
      return <ShippingOptionsBlock options={block.data?.options} />;
    case "coupon_input":
      return <CouponInputBlock data={block.data} />;
    case "payment_methods":
      return <PaymentMethodsBlock methods={block.data?.methods} />;
    case "pix_payment":
      return <PixPaymentBlock data={block.data} />;
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
    default:
      if (block.text) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{block.text}</p>;
      if (block.data?.text || block.data?.content) return <p style={{ fontSize: "14px", lineHeight: 1.5, color: "var(--tx)", margin: 0, wordBreak: "break-word" }}>{String(block.data.text || block.data.content)}</p>;
      return null;
  }
}
