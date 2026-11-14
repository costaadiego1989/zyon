import { useEffect, useRef, useState } from "react";
import { requestCashback, type CashbackCheckoutQuote } from "../api/cashback";
import { CheckoutApiError } from "../api/checkout-api-error";
import { useCheckoutStore, type CartState } from "../store/checkout-store";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const revision = (cart: CartState) => JSON.stringify([cart.items.map(item => [item.sku, item.variant, item.quantity, item.price]), cart.shipping, cart.discount,
  ...(cart.commercialBenefitsVersion !== undefined && cart.commercialBenefitsVersion > 0 ? [cart.commercialBenefitsVersion] : [])]);

function errorCopy(error: unknown): string {
  const code = error instanceof CheckoutApiError ? error.code ?? "" : "";
  if (/buyer|identity|auth/.test(code)) return "Entre na sua conta da loja para consultar e utilizar seu cashback.";
  if (/payment.*pending|payment.*bound|payment.*locked/.test(code)) return "Este crédito está vinculado a um pagamento em andamento. Aguarde a confirmação ou o cancelamento.";
  if (/fingerprint|cart.*changed|quote.*expired/.test(code)) return "Seu pedido mudou. Atualize o saldo antes de escolher o cashback.";
  return "Não foi possível confirmar o cashback. Seu saldo não foi alterado nesta tela. Atualize para consultar a situação.";
}

export function CashbackCheckout() {
  const api = useCheckoutStore(state => state.api);
  const sessionId = useCheckoutStore(state => state.sessionId);
  const cart = useCheckoutStore(state => state.cart);
  const status = useCheckoutStore(state => state.status);
  const cartUpdating = useCheckoutStore(state => state.cartUpdating);
  const paymentSubmitting = useCheckoutStore(state => state.paymentSubmitting);
  const payment = useCheckoutStore(state => state.paymentIntent);
  const shippingMode = useCheckoutStore(state => state.shippingMode);
  const [storedQuote, setQuote] = useState<CashbackCheckoutQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const operation = useRef<{ context: string; key: string } | null>(null);
  const cartRevision = revision(cart);
  const quote = storedQuote?.merchantId === api?.currentMerchantId && storedQuote?.sessionId === sessionId ? storedQuote : null;
  const locked = paymentSubmitting || Boolean(payment && ["pending", "requires_action", "approved"].includes(payment.status));

  useEffect(() => {
    if (!api || !sessionId || shippingMode === "marketplace" || status !== "active" || !cart.items.length) return;
    const controller = new AbortController();
    setLoading(true); setError(null); setUnavailable(false);
    void requestCashback(api, "quote", undefined, controller.signal).then(next => {
      if (controller.signal.aborted || useCheckoutStore.getState().api !== api || revision(useCheckoutStore.getState().cart) !== cartRevision) return;
      setQuote(next); setAmount((next.maximumRedeemCents / 100).toFixed(2));
      const state = useCheckoutStore.getState();
      // A paid/pending attempt owns its frozen amount; a later quote cannot rewrite it.
      if (!state.paymentSubmitting && (!state.paymentIntent || ["failed", "cancelled", "expired"].includes(state.paymentIntent.status))) {
        if ((state.cart.cashbackCents ?? 0) !== next.reservedCents) useCheckoutStore.setState({ cart: { ...state.cart, cashbackCents: next.reservedCents, totalToPay: undefined } });
      }
    }).catch(cause => {
      if (controller.signal.aborted) return;
      if (cause instanceof CheckoutApiError && cause.status === 404) setUnavailable(true);
      else setError(errorCopy(cause));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, sessionId, cartRevision, shippingMode, status, attempt, cart.items.length]);

  async function mutate(kind: "reserve" | "remove") {
    if (!api || !sessionId || !quote || busy.current || locked || cartUpdating) return;
    const amountCents = kind === "reserve" ? Math.round(Number(amount.replace(",", ".")) * 100) : 0;
    if (kind === "reserve" && (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > quote.maximumRedeemCents)) {
      setError(`Escolha um valor entre R$ 0,01 e ${money(quote.maximumRedeemCents)}.`); return;
    }
    const context = `${kind}:${sessionId}:${quote.fingerprint}:${cartRevision}:${amountCents}`;
    if (operation.current?.context !== context) operation.current = { context, key: globalThis.crypto.randomUUID() };
    busy.current = true; setLoading(true); setError(null);
    useCheckoutStore.setState({ cartUpdating: true });
    try {
      const next = await requestCashback(api, kind, { amountCents, idempotencyKey: operation.current.key });
      const state = useCheckoutStore.getState();
      if (state.api !== api || state.sessionId !== sessionId || revision(state.cart) !== cartRevision) return;
      setQuote(next); setAmount((next.maximumRedeemCents / 100).toFixed(2));
      useCheckoutStore.setState({ cart: { ...state.cart, cashbackCents: next.reservedCents, totalToPay: undefined } });
      operation.current = null;
    } catch (cause) { setError(errorCopy(cause)); }
    finally {
      busy.current = false; setLoading(false);
      if (useCheckoutStore.getState().api === api && useCheckoutStore.getState().sessionId === sessionId) useCheckoutStore.setState({ cartUpdating: false });
    }
  }

  if (!api || !sessionId || shippingMode === "marketplace" || status !== "active" || unavailable && !(cart.cashbackCents ?? 0) || !cart.items.length) return null;
  if (!loading && !error && quote && !quote.programActive && !quote.availableCents && !quote.reservedCents) return null;
  return <section className="checkout-cashback" aria-label="Cashback nesta compra" aria-busy={loading}>
    <style>{`
      .checkout-cashback{padding:14px 0;margin:8px 0;border-top:1px solid var(--bd);color:var(--tx);font-size:12px;line-height:1.5;min-width:0}
      .checkout-cashback h3{margin:0 0 5px;font-size:13px;font-weight:650}.checkout-cashback p{margin:6px 0;overflow-wrap:anywhere}
      .checkout-cashback__row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.checkout-cashback__row strong{white-space:nowrap;font-variant-numeric:tabular-nums}
      .checkout-cashback__form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin-top:10px}.checkout-cashback label{flex:1 1 90px;font-size:11px}
      .checkout-cashback input{box-sizing:border-box;display:block;width:100%;min-height:44px;margin-top:5px;padding:9px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--chip);color:var(--tx);font:inherit;font-size:13px}
      .checkout-cashback button{min-height:44px;padding:10px 12px;color:var(--tx);font:inherit;font-weight:600;cursor:pointer}.checkout-cashback button:disabled{opacity:.55;cursor:default}
      .checkout-cashback input:focus-visible,.checkout-cashback button:focus-visible,.checkout-cashback summary:focus-visible{outline:2px solid var(--aacp-accent-text,var(--tx));outline-offset:3px}
      .checkout-cashback__notice{color:var(--mut)}.checkout-cashback__error{padding:8px 0;color:var(--tx)}.checkout-cashback details{margin-top:10px}.checkout-cashback summary{cursor:pointer;padding:4px 0}
      .checkout-cashback details p{white-space:pre-wrap}.checkout-cashback__skeleton{height:32px;border-radius:8px;background:var(--chip)}
    `}</style>
    <h3>Cashback</h3>
    {!quote && (cart.cashbackCents ?? 0) > 0 && <div className="checkout-cashback__row"><span>Aplicado no total do pedido</span><strong>−{money(cart.cashbackCents!)}</strong></div>}
    {loading && !quote && <div role="status"><div className="checkout-cashback__skeleton" /><p>Consultando cashback…</p></div>}
    {error && <div className="checkout-cashback__error" role="alert"><p>{error}</p><button type="button" data-neu="secondary" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Atualizar cashback</button></div>}
    {quote && <>
      <div className="checkout-cashback__row"><span>Disponível nesta loja</span><strong>{money(quote.availableCents)}</strong></div>
      {quote.reservedCents > 0 ? <>
        <div className="checkout-cashback__row"><span>Aplicado nesta compra</span><strong>−{money(quote.reservedCents)}</strong></div>
        <p className="checkout-cashback__notice">O crédito fica reservado até a confirmação do pagamento.</p>
        <button type="button" data-neu="secondary" disabled={loading || locked || cartUpdating} onClick={() => void mutate("remove")}>Remover cashback</button>
      </> : quote.eligible && quote.maximumRedeemCents > 0 ? <form className="checkout-cashback__form" onSubmit={event => { event.preventDefault(); void mutate("reserve"); }}>
        <label>Valor a utilizar (R$)<input aria-label="Valor de cashback a utilizar" type="number" inputMode="decimal" min="0.01" max={(quote.maximumRedeemCents / 100).toFixed(2)} step="0.01" value={amount} disabled={loading || locked || cartUpdating} onChange={event => setAmount(event.target.value)} /></label>
        <button type="submit" data-neu="primary" disabled={loading || locked || cartUpdating}>Usar cashback</button>
        <p className="checkout-cashback__notice">Você pode usar até {money(quote.maximumRedeemCents)} neste pedido.</p>
      </form> : <p className="checkout-cashback__notice">{quote.reason && /buyer|identity|auth/.test(quote.reason) ? "Entre na sua conta da loja para consultar seu saldo." : quote.availableCents > 0 ? "Este pedido ainda não atende às condições para usar o saldo." : "Você ainda não tem crédito disponível para esta compra."}</p>}
      {quote.estimatedEarnCents > 0 && <p>Cashback previsto desta compra: <strong>{money(quote.estimatedEarnCents)}</strong>. A liberação segue as condições da loja.</p>}
      {locked && <p role="status">O pagamento está em andamento. O cashback desta cobrança não pode ser alterado.</p>}
      {quote.terms && <details><summary>Condições do cashback</summary><p>{quote.terms}</p></details>}
    </>}
    {loading && quote && <p role="status">Confirmando cashback…</p>}
  </section>;
}
