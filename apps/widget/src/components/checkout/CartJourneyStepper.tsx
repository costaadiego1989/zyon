import { Check, CreditCard, ShoppingBag, Truck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CART_JOURNEY, cn, resolveCartJourneyIndex, resolveStepperProgressPct } from "../../hooks/checkout-view-model.js";

const JOURNEY_ICONS: Record<(typeof CART_JOURNEY)[number]["key"], LucideIcon> = {
  items: ShoppingBag,
  identity: UserRound,
  delivery: Truck,
  payment: CreditCard
};

export function CartJourneyStepper({
  checkoutStage,
  itemCount
}: {
  checkoutStage: string;
  itemCount: number;
}) {
  const activeIndex = resolveCartJourneyIndex(checkoutStage, itemCount);
  const allDone = checkoutStage === "completed";
  const progressPct = allDone ? 100 : resolveStepperProgressPct(activeIndex, CART_JOURNEY.length);

  return (
    <nav className="aacp-cart-journey aacp-cart-journey--horizontal" aria-label="Jornada do carrinho">
      <div className="aacp-cart-journey-rail-wrap">
        <div className="aacp-cart-journey-track" aria-hidden>
          <div className="aacp-cart-journey-track-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="aacp-cart-journey-rail">
          {CART_JOURNEY.map((step, index) => {
            const status = allDone
              ? "done"
              : index < activeIndex
                ? "done"
                : index === activeIndex
                  ? "active"
                  : "pending";
            const Icon = JOURNEY_ICONS[step.key];

            return (
              <li key={step.key} className={cn("aacp-cart-journey-step", status)}>
                <span className="aacp-cart-journey-marker" aria-hidden>
                  {status === "done" ? <Check size={12} strokeWidth={2.75} /> : <Icon size={13} />}
                </span>
                <span className="aacp-cart-journey-label">{step.shortLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
