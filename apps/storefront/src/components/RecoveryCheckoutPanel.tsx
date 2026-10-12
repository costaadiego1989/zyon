"use client";
import { useEffect, useRef, useState } from "react";
import { clearBuyerSession, getValidBuyer } from "@/lib/buyer-auth";
import BuyerLoginForm from "./BuyerLoginForm";
import CheckoutPanel from "./CheckoutPanel";
import styles from "./RecoveryCheckoutPanel.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
const messages: Record<string, string> = {
  recovery_link_invalid_or_expired: "Este link expirou ou não é válido. Volte à loja para continuar sua compra.",
  recovery_purchase_completed: "Esta compra já foi concluída. Você pode acompanhar o pedido na sua conta.",
  recovery_purchase_unavailable: "Este carrinho não está mais disponível. Volte à loja para escolher seus produtos.",
  recovery_store_mismatch: "Este link pertence a outra loja. Abra o endereço completo recebido na mensagem.",
  recovery_buyer_mismatch: "Entre com a conta usada nesta compra para continuar.",
};
export default function RecoveryCheckoutPanel({ token, slug, merchantId, storeName, theme, onClose }: {
  token: string; slug: string; merchantId: string; storeName: string; theme: "dark" | "light"; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "login" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [embedToken, setEmbedToken] = useState("");
  const [wrongBuyer, setWrongBuyer] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setRetryable(false);
    setWrongBuyer(false);
    fetch(`${API_BASE}/storefront/${encodeURIComponent(slug)}/recovery`, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, buyer_access_token: getValidBuyer()?.token }),
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (response.ok && body.merchant_id === merchantId && typeof body.embed_session_token === "string") {
        setEmbedToken(body.embed_session_token); setStatus("ready"); return;
      }
      const code = typeof body.code === "string" ? body.code : typeof body.message === "string" ? body.message : body.error;
      if (code === "recovery_buyer_login_required") { setStatus("login"); return; }
      setWrongBuyer(code === "recovery_buyer_mismatch");
      setRetryable(response.status >= 500 || response.status === 429);
      setError(messages[code] ?? "Não foi possível abrir sua compra agora. Tente novamente.");
      setStatus("error");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setRetryable(true); setError("A conexão foi interrompida. Tente novamente para abrir sua compra."); setStatus("error");
    });
    return () => controller.abort();
  }, [token, slug, merchantId, attempt]);
  const ready = status === "ready";
  useEffect(() => {
    const root = panel.current;
    if (!root || ready) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.focus();
    const contain = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) root.focus();
    };
    document.addEventListener("focusin", contain);
    return () => { document.removeEventListener("focusin", contain); if (previous?.isConnected) previous.focus(); };
  }, [ready]);
  if (status === "ready") return <CheckoutPanel merchantId={merchantId} globalUserId={getValidBuyer()?.globalUserId ?? ""}
    cartRef={undefined} initialEmbedToken={embedToken} recovered theme={theme} onClose={onClose} />;
  return <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" className={styles.panel} aria-labelledby="recovery-title" data-aacp-recovery
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className={styles.content}>
      <button data-neu="control" type="button" onClick={onClose}>Voltar à loja</button>
      <h1 id="recovery-title">{status === "login" ? "Continue sua compra" : status === "loading" ? "Abrindo sua compra" : "Não foi possível continuar"}</h1>
      {status === "loading" ? <p role="status">Estamos conferindo seu carrinho.</p> : null}
      {status === "login" ? <>
        <p>Entre com o e-mail usado na compra para revisar os itens, a entrega e o pagamento.</p>
        <BuyerLoginForm merchantId={merchantId} merchantName={storeName} onCancel={onClose}
          onComplete={() => setAttempt(value => value + 1)}
          onAccountNotFound={() => { setError("Use o e-mail da conta que iniciou esta compra."); setWrongBuyer(true); setStatus("error"); }} />
      </> : null}
      {status === "error" ? <>
        <p role="alert">{error}</p>
        {retryable ? <button data-neu="control" type="button" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button> : null}
        {wrongBuyer ? <button data-neu="control" type="button" onClick={() => { clearBuyerSession(); setStatus("login"); }}>Entrar com outra conta</button> : null}
      </> : null}
    </div>
  </section>;
}
