import { CheckCircle2, CreditCard, Truck, UserRound } from "lucide-react";
import type { CheckoutAgentViewModel } from "../../hooks/use-checkout-agent-view-model.js";
import { cn, STAGE_FLOW, stageLabel } from "../../hooks/checkout-view-model.js";

const STEP_ICONS = {
  data_collection: UserRound,
  shipping: Truck,
  payment: CreditCard,
  completed: CheckCircle2
} as const;

export function CheckoutStepper({ vm }: { vm: CheckoutAgentViewModel }) {
  const activeIndex = STAGE_FLOW.findIndex((step) => step.key === vm.checkoutStage);
  return (
    <section className="flex border-b border-white/5 bg-white/[0.02]" aria-label="Fluxo do checkout">
      <div
        className="flex-1 flex"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={(Math.max(activeIndex, 0) + 1) * 25}
        aria-label={`Etapa: ${stageLabel(vm.checkoutStage)}`}
      >
        {STAGE_FLOW.map((step, index) => {
          const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "todo";
          const Icon = STEP_ICONS[step.key];
          return (
            <div className="flex-1 flex items-center relative" key={step.key}>
              <div className={cn(
                "flex-1 py-3 px-2 flex flex-col items-center gap-1.5 relative transition-all",
                status === "active" ? "text-purple-400 font-bold bg-white/[0.03]" : status === "done" ? "text-emerald-400/80" : "text-white/20"
              )}>
                <div className={cn(
                  "w-6 h-6 rounded-lg flex items-center justify-center shadow-inner",
                  status === "active" ? "bg-purple-500/10" : status === "done" ? "bg-emerald-500/10" : "bg-white/5"
                )} aria-hidden="true">
                  {status === "done" ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                </div>
                <div className="text-[10px] uppercase tracking-widest">{step.shortLabel}</div>
                {status === "active" ? (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                ) : null}
              </div>
              {index < STAGE_FLOW.length - 1 ? (
                <div className="absolute right-[-4px] top-1/2 -translate-y-1/2 z-10 w-2 h-2 rounded-full border border-white/10 bg-[#0f0d1a]" />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
