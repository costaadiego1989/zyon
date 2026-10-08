import { useEffect, useState, useCallback } from "react";
import { marketplaceCardActionCurrent, useCheckoutStore } from "@/store/checkout-store";
import { PulseAgentOrb } from "./PulseAgentOrb";
import { buyerServiceFeeCopy, checkoutLocale } from "@/lib/checkout-totals";
import { paymentPollingOutcome } from "@/lib/payment-status";

export function PixPayment({ data }: { data?: Record<string, unknown> }) {
  const state = useCheckoutStore();
  const payment = data ?? state.paymentIntent;
  const intentId = typeof payment?.intent_id === "string" ? payment.intent_id : undefined;
  const expiresAt = typeof payment?.expires_at_unix === "number" ? payment.expires_at_unix : undefined;
  const code = typeof payment?.pix_code === "string" ? payment.pix_code : "";
  const qrUrl = typeof payment?.pix_qr_url === "string" ? payment.pix_qr_url : undefined;
  const amount = typeof payment?.amount_cents === "number" ? payment.amount_cents : undefined;
  const scoped = typeof data?.marketplace_context === "string";
  const matching = Boolean(intentId && intentId === state.paymentIntent?.intent_id);
  const active = matching && state.status === "active" && paymentPollingOutcome(state.paymentIntent?.status) === "pending" &&
    (!scoped || marketplaceCardActionCurrent(state, intentId, data?.marketplace_context));
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const expired = expiresAt !== undefined && expiresAt * 1000 <= Date.now() || timeLeft === 0;
  const busy = state.assistanceBusy || state.paymentSubmitting || state.cartUpdating || state.isTyping || Boolean(state.paymentCancellationPending);

  useEffect(() => {
    if (active) state.pollPayment();
    // The store owns polling. Removing one of two cards for the same Pix must not stop it.
  }, [active, intentId, state.pollPayment]);

  useEffect(() => {
    setCopied(false);
    if (expiresAt === undefined) { setTimeLeft(null); return; }
    const update = () => setTimeLeft(Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, intentId]);

  const handleCopy = useCallback(async () => {
    const live = useCheckoutStore.getState();
    if (!code || !intentId || live.paymentIntent?.intent_id !== intentId || live.status !== "active" ||
      paymentPollingOutcome(live.paymentIntent.status) !== "pending" || live.paymentCancellationPending ||
      expiresAt !== undefined && expiresAt * 1000 <= Date.now() ||
      scoped && (!marketplaceCardActionCurrent(live, intentId, data?.marketplace_context) || expiresAt === undefined)) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const success = document.execCommand("copy");
      textarea.remove();
      if (!success) return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code, intentId, expiresAt, scoped, data?.marketplace_context]);

  if (!payment || !intentId) return null;

  if (matching && state.status === "completed") return <div data-neu="surface" className="pix-payment pix-payment--confirmed">
    <div className="pix-payment__icon" aria-hidden="true">✓</div>
    <h3 className="pix-payment__title">Pagamento confirmado!</h3>
    <p className="pix-payment__sub">Seu pedido está sendo processado.</p>
  </div>;

  const header = <div className="pix-payment__header">
    <h3 className="pix-payment__title">{active && !expired ? "Pague com Pix" : "Pagamento Pix"}</h3>
  </div>;
  const total = amount !== undefined && Number.isSafeInteger(amount) && amount > 0 && <div className="pix-payment__total">
    <span>Total a pagar</span><strong className="pix-payment__amount">
      {new Intl.NumberFormat(checkoutLocale(state.agent.language), { style: "currency", currency: "BRL" }).format(amount / 100)}
    </strong>
  </div>;

  if (!active || expired) return <div data-neu="surface" className="pix-payment">
    {header}
    {total}
    <p className="pix-payment__instruction">{expired ? "O prazo deste código Pix terminou. Consulte o pagamento antes de gerar outro código." : "Consulte o estado atual desta cobrança no checkout."}</p>
    {matching && state.status === "active" && !state.paymentObservation && state.assistance.pix &&
      <button type="button" data-neu="control" className="pix-payment__regenerate-btn" disabled={busy}
        onClick={() => state.showCheckoutHelp("pix", true)}>Ajuda com este Pix</button>}
  </div>;

  const timeLabel = timeLeft !== null ? Math.floor(timeLeft / 60) + ":" + (timeLeft % 60).toString().padStart(2, "0") : null;
  return <div data-neu="surface" className="pix-payment" aria-busy={state.assistanceBusy}>
    {header}
    <p className="pix-payment__instruction">Escaneie o QR Code no app do seu banco ou copie o código abaixo.
      Seu pedido é confirmado automaticamente assim que o pagamento é detectado.</p>
    {total}
    {state.cart.serviceFee > 0 && <p className="pix-payment__instruction" data-testid="buyer-service-fee-notice">
      <strong>{buyerServiceFeeCopy(state.agent.language).label}: {new Intl.NumberFormat(checkoutLocale(state.agent.language), { style: "currency", currency: "BRL" }).format(state.cart.serviceFee)}.</strong>{" "}
      {buyerServiceFeeCopy(state.agent.language).notice}
    </p>}
    {qrUrl && <div className="pix-payment__qr"><img src={qrUrl} alt="QR Code Pix" className="pix-payment__qr-img" /></div>}
    {code && <div className="pix-payment__code">
      <code className="pix-payment__code-text">{code.length > 60 ? code.slice(0, 30) + "..." + code.slice(-20) : code}</code>
      <button type="button" data-neu="primary" className={"pix-payment__copy-btn" + (copied ? " pix-payment__copy-btn--copied" : "")}
        disabled={Boolean(state.paymentCancellationPending)} onClick={() => void handleCopy()}>{copied ? "✓ Copiado" : "Copiar código"}</button>
    </div>}
    <div className="pix-payment__status">
      <div className="pix-payment__waiting">
        <PulseAgentOrb placement="chatLoading" active />
        <span className="pix-payment__timer">{timeLabel ? "Aguardando pagamento · expira em " + timeLabel : "Aguardando pagamento..."}</span>
      </div>
    </div>
    {state.assistance.pix && !state.paymentObservation && <button type="button" data-neu="control" className="pix-payment__regenerate-btn" disabled={busy}
      onClick={() => void state.runHelpAction("check_payment", intentId)}>{state.assistanceBusy ? "Consultando..." : "Consultar pagamento"}</button>}
  </div>;
}
