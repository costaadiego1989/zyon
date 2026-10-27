import { CHECKOUT_LINK_EXPIRED_MESSAGE, MERCHANT_SALES_SUSPENDED_MESSAGE } from "../lib/checkout-error-message";

export function CheckoutUnavailable({ error, onClose }: { error?: string | null; onClose?: () => void }) {
  const expired = error === CHECKOUT_LINK_EXPIRED_MESSAGE;
  const suspended = error === MERCHANT_SALES_SUSPENDED_MESSAGE;
  const phone = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("whatsappNumber");
  const whatsappUrl = expired && phone && /^\d{8,15}$/.test(phone)
    ? `https://wa.me/${phone}?text=${encodeURIComponent("Finalizar pedido")}` : undefined;
  return (
    <section className="checkout-error" role="alert" aria-labelledby="checkout-unavailable-title">
      <h2 id="checkout-unavailable-title">{expired ? "Abra um novo link para continuar" : suspended ? "Loja temporariamente indisponível" : "Não foi possível abrir seu pedido"}</h2>
      <p>{error || "Tente novamente em instantes para continuar seu pedido."}</p>
      <div className="checkout-error__actions">
        {whatsappUrl ? <a data-neu="control" href={whatsappUrl}>Voltar ao WhatsApp</a>
          : !expired && !suspended && <button data-neu="control" onClick={() => window.location.reload()}>Tentar novamente</button>}
        {onClose && <button data-neu="control" onClick={onClose}>Voltar à loja</button>}
      </div>
    </section>
  );
}
