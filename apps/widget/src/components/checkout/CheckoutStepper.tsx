import React from "react";
import { CheckCircle2, CreditCard, Truck, UserRound } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, STAGE_FLOW } from "../../hooks/checkout-view-model.js";

const STEP_ICONS = {
  data_collection: UserRound,
  shipping: Truck,
  payment: CreditCard,
  completed: CheckCircle2
} as const;

export function CheckoutStepper({ vm }: { vm: CheckoutAgentViewModel }) {
  const activeIndex = STAGE_FLOW.findIndex((step) => step.key === vm.checkoutStage);

  return (
    <nav className="aacp-timeline" aria-label="Progresso do checkout">
      {STAGE_FLOW.map((step, index) => {
        const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
        const Icon = STEP_ICONS[step.key];
        const isLast = index === STAGE_FLOW.length - 1;

        return (
          <React.Fragment key={step.key}>
            <div className={cn("aacp-tl-step", status)}>
              <div className="aacp-tl-node" aria-hidden="true">
                {status === "done" ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              </div>
              <div className="aacp-tl-label">{step.shortLabel}</div>
            </div>
            {!isLast && (
              <div className={cn("aacp-tl-line", index < activeIndex ? "filled" : "")} />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
