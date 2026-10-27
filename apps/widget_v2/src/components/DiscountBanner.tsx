import { useCheckoutStore } from "@/store/checkout-store";

export type DiscountStage =
  | "initial_coupon"
  | "exit_intent"
  | "abandoned_cart"
  | "payment_nudge";

interface DiscountBannerProps {
  stage: DiscountStage;
  percent: number;
  couponCode?: string;
  message?: string;
  onDismiss: () => void;
}

export function DiscountBanner({
  stage,
  percent,
  couponCode,
  message,
  onDismiss,
}: DiscountBannerProps) {
  const brand = useCheckoutStore((s) => s.brand);
  const buyer = useCheckoutStore((s) => s.buyer);

  const isReturning = (buyer.purchaseCount ?? 0) > 0 || buyer.isReturning;
  if (!message?.trim() && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) return null;

  const defaultMessages: Record<string, string> = {
    initial_coupon: isReturning
      ? `🎉 Que bom ter você de volta! ${percent}% OFF nesta compra`
      : `🎉 Cupom de boas-vindas: ${percent}% OFF aplicado!`,
    exit_intent: `⚡ Espera! Ganhe ${percent}% OFF se finalizar agora`,
    abandoned_cart: `🔥 Oferta especial: ${percent}% de desconto no seu carrinho`,
    payment_nudge: `💰 Última chance! ${percent}% OFF para fechar agora`,
  };

  const text = message && message.trim().length > 0 ? message : defaultMessages[stage];
  const accent = brand.accentColor || "var(--aacp-accent, #0f766e)";

  return (
    <div data-neu="surface"
      className="discount-banner"
      data-testid="discount-banner"
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "11px 12px",
        margin: "8px 0",
        borderRadius: "12px",
        border: `1px solid ${accent}`,
        background: "linear-gradient(135deg, color-mix(in srgb, " + (brand.accentColor || "#0f766e") + " 14%, var(--aacp-surface, #fff)), var(--aacp-surface, #fff))",
        color: "var(--aacp-fg, #111827)",
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 9, background: accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: 15 }}>✦</span>
      <span className="discount-banner__text" data-testid="discount-banner-text" style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{text}</span>
      {couponCode && (
        <span
          className="discount-banner__coupon"
          data-testid="discount-banner-coupon"
          style={{
            padding: "2px 8px",
            borderRadius: "6px",
            border: `1px dashed ${accent}`,
            fontWeight: 700,
            fontSize: "12px",
            letterSpacing: "0.5px",
          }}
        >
          {couponCode}
        </span>
      )}
      <button data-neu="icon"
        className="discount-banner__dismiss"
        onClick={onDismiss}
        aria-label="Fechar"
        style={{ width: 32, height: 32, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer", color: "var(--aacp-muted, #64748B)", fontSize: "16px", lineHeight: 1, padding: 0, borderRadius: 8 }}
      >
        ✕
      </button>
    </div>
  );
}
