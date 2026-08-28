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

  const defaultMessages: Record<string, string> = {
    initial_coupon: `🎉 Cupom de boas-vindas: ${percent}% OFF aplicado!`,
    exit_intent: `⚡ Espera! Ganhe ${percent}% OFF se finalizar agora`,
    abandoned_cart: `🔥 Oferta especial: ${percent}% de desconto no seu carrinho`,
    payment_nudge: `💰 Última chance! ${percent}% OFF para fechar agora`,
  };

  const text = message && message.trim().length > 0 ? message : defaultMessages[stage];
  const accent = brand.accentColor || "var(--aacp-accent, #0f766e)";

  return (
    <div
      className="discount-banner"
      data-testid="discount-banner"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 14px",
        margin: "8px 0",
        borderRadius: "10px",
        border: `1px solid ${accent}`,
        background: "color-mix(in srgb, " + (brand.accentColor || "#0f766e") + " 8%, var(--aacp-surface, #fff))",
        color: "var(--aacp-fg, #111827)",
        fontSize: "13px",
        fontWeight: 500,
      }}
    >
      <span className="discount-banner__text" data-testid="discount-banner-text" style={{ flex: 1 }}>{text}</span>
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
      <button
        className="discount-banner__dismiss"
        onClick={onDismiss}
        aria-label="Fechar"
        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--aacp-muted, #64748B)", fontSize: "14px", lineHeight: 1, padding: 0 }}
      >
        ✕
      </button>
    </div>
  );
}
