import { useEffect, useState, useCallback } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { PulseAgentOrb } from "./PulseAgentOrb";

export function PixPayment() {
  const paymentIntent = useCheckoutStore((s) => s.paymentIntent);
  const pollPayment = useCheckoutStore((s) => s.pollPayment);
  const stopPolling = useCheckoutStore((s) => s.stopPolling);
  const status = useCheckoutStore((s) => s.status);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  // Start polling on mount
  useEffect(() => {
    pollPayment();
    return () => stopPolling();
  }, [pollPayment, stopPolling]);

  // Countdown timer
  useEffect(() => {
    if (!paymentIntent?.expires_at_unix) return;
    const update = () => {
      const now = Math.floor(Date.now() / 1000);
      const left = paymentIntent.expires_at_unix! - now;
      setTimeLeft(left > 0 ? left : 0);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [paymentIntent?.expires_at_unix]);

  const handleCopy = useCallback(async () => {
    if (!paymentIntent?.pix_code) return;
    await navigator.clipboard.writeText(paymentIntent.pix_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [paymentIntent?.pix_code]);

  if (!paymentIntent) return null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  if (status === "completed") {
    return (
      <div className="pix-payment pix-payment--confirmed">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "16px 0" }}>
          <div style={{ animation: "bounce 0.6s ease infinite alternate" }}>
            <PulseAgentOrb placement="chatBubble" active />
          </div>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--tx)", margin: 0, textAlign: "center" }}>
            Pagamento confirmado! 🎉
          </p>
        </div>
        <div className="pix-payment__icon">✓</div>
        <h3 className="pix-payment__title">Pagamento confirmado!</h3>
        <p className="pix-payment__sub">Seu pedido está sendo processado.</p>
        <style>{`@keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }`}</style>
      </div>
    );
  }

  return (
    <div className="pix-payment">
      <div className="pix-payment__header">
        <h3 className="pix-payment__title">Pague com Pix</h3>
        {paymentIntent.amount_cents && (
          <span className="pix-payment__amount">{formatCurrency(paymentIntent.amount_cents)}</span>
        )}
      </div>

      <p className="pix-payment__instruction">
        Escaneie o QR Code no app do seu banco ou copie o código abaixo.
        Seu pedido é confirmado automaticamente assim que o pagamento é detectado.
      </p>

      {/* QR Code Image */}
      {paymentIntent.pix_qr_url && (
        <div className="pix-payment__qr">
          <img
            src={paymentIntent.pix_qr_url}
            alt="QR Code Pix"
            className="pix-payment__qr-img"
          />
        </div>
      )}

      {/* Copy-paste code */}
      {paymentIntent.pix_code && (
        <div className="pix-payment__code">
          <code className="pix-payment__code-text">
            {paymentIntent.pix_code.length > 60
              ? paymentIntent.pix_code.slice(0, 30) + "..." + paymentIntent.pix_code.slice(-20)
              : paymentIntent.pix_code}
          </code>
          <button
            className={`pix-payment__copy-btn ${copied ? "pix-payment__copy-btn--copied" : ""}`}
            onClick={() => void handleCopy()}
          >
            {copied ? "✓ Copiado" : "Copiar código"}
          </button>
        </div>
      )}

      {/* Timer */}
      <div className="pix-payment__status">
        {timeLeft !== null && timeLeft > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "8px 0" }}>
            <PulseAgentOrb placement="chatLoading" active />
            <span className="pix-payment__timer">
              Aguardando pagamento · expira em {formatTime(timeLeft)}
            </span>
          </div>
        ) : timeLeft === 0 ? (
          <>
            <span className="pix-payment__expired">⚠️ Código expirado.</span>
            <button
              className="pix-payment__regenerate-btn"
              onClick={() => useCheckoutStore.getState().pay('pix')}
            >
              Gerar novo Pix
            </button>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "8px 0" }}>
            <PulseAgentOrb placement="chatLoading" active />
            <span className="pix-payment__waiting">Aguardando pagamento...</span>
          </div>
        )}
      </div>
    </div>
  );
}
