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

  // Prefer the merchant's configured message; fall back to a stage template.
  const text = message && message.trim().length > 0 ? message : defaultMessages[stage];

  return (
    <div className="discount-banner" style={{ borderColor: brand.accentColor }}>
      <span className="discount-banner__text">{text}</span>
      {couponCode && (
        <span
          className="discount-banner__coupon"
          style={{
            marginLeft: "8px",
            padding: "2px 8px",
            borderRadius: "6px",
            border: `1px dashed ${brand.accentColor || "var(--aacp-accent, #0f766e)"}`,
            fontWeight: 700,
            fontSize: "12px",
            letterSpacing: "0.5px",
          }}
        >
          {couponCode}
        </span>
      )}
      <button className="discount-banner__dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
