import { CheckCircle2, CreditCard, Truck, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, STAGE_FLOW } from "../../hooks/checkout-presentation.js";

const STEP_ICONS: Record<(typeof STAGE_FLOW)[number]["key"], LucideIcon> = {
  data_collection: UserRound,
  shipping: Truck,
  payment: CreditCard,
  completed: CheckCircle2
};

export function CheckoutProgressRail({
  activeStage,
  className
}: {
  activeStage: string;
  className?: string;
}) {
  const activeIndex = Math.max(0, STAGE_FLOW.findIndex((step) => step.key === activeStage));
  const progressPct = (activeIndex / Math.max(STAGE_FLOW.length - 1, 1)) * 100;

  return (
    <nav
      className={cn("zyon-progress-rail zyon-progress-rail--main", className)}
      aria-label="Progresso do checkout"
    >
      <div className="zyon-progress-rail-inner">
        <div className="zyon-progress-line" aria-hidden>
          <div className="zyon-progress-line-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="zyon-progress-track">
          {STAGE_FLOW.map((step, index) => {
            const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
            const Icon = STEP_ICONS[step.key];

            return (
              <li key={step.key} className="zyon-progress-item">
                <div className={cn("zyon-progress-step", status)}>
                  <div className="zyon-progress-node" aria-current={status === "active" ? "step" : undefined}>
                    {status === "done" ? <CheckCircle2 size={14} aria-hidden /> : <Icon size={14} aria-hidden />}
                  </div>
                  <span className="zyon-progress-label">{step.shortLabel}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
