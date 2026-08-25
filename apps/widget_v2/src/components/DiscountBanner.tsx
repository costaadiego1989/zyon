import { useCheckoutStore } from "@/store/checkout-store";

export type DiscountStage =
  | "initial_coupon"
  | "exit_intent"
  | "abandoned_cart"
  | "payment_nudge";

interface DiscountBannerProps {
  stage: DiscountStage;
  percent: number;
  onDismiss: () => void;
}

export function DiscountBanner({
  stage,
  percent,
  onDismiss,
}: DiscountBannerProps) {
  const brand = useCheckoutStore((s) => s.brand);

  const messages: Record<string, string> = {
    initial_coupon: `🎉 Cupom de boas-vindas: ${percent}% OFF aplicado!`,
    exit_intent: `⚡ Espera! Ganhe ${percent}% OFF se finalizar agora`,
    abandoned_cart: `🔥 Oferta especial: ${percent}% de desconto no seu carrinho`,
    payment_nudge: `💰 Última chance! ${percent}% OFF para fechar agora`,
  };

  return (
    <div className="discount-banner" style={{ borderColor: brand.accentColor }}>
      <span className="discount-banner__text">{messages[stage]}</span>
      <button className="discount-banner__dismiss" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
