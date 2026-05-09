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
  const isDark = vm.colorMode === "dark";

  return (
    <section className={cn("flex border-b h-[60px]", isDark ? "border-white/5 bg-white/[0.02]" : "border-slate-200 bg-white")} aria-label="Fluxo do checkout">
      <div
        className="flex-1 flex items-stretch h-full overflow-hidden aacp-flow-rail"
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
                "flex-1 px-2 flex flex-col items-center justify-center gap-1 relative transition-all h-full",
                status === "active"
                  ? isDark ? "text-purple-400 font-bold bg-purple-500/5" : "text-purple-600 font-bold bg-purple-50"
                  : status === "done"
                    ? isDark ? "text-emerald-400/80" : "text-emerald-600"
                    : isDark ? "text-white/20" : "text-slate-300"
              )}>
                <div className={cn(
                  "w-6 h-6 rounded-lg flex items-center justify-center shadow-inner",
                  status === "active"
                    ? isDark ? "bg-purple-500/10" : "bg-purple-100"
                    : status === "done"
                      ? isDark ? "bg-emerald-500/10" : "bg-emerald-100"
                      : isDark ? "bg-white/5" : "bg-slate-50"
                )} aria-hidden="true">
                  {status === "done" ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                </div>
                <div className="text-[10px] uppercase tracking-widest">{step.shortLabel}</div>
                {status === "active" ? (
                  <div className={cn("absolute bottom-0 left-0 right-0 h-[2px]", isDark ? "bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" : "bg-purple-600")} />
                ) : null}
              </div>
              {index < STAGE_FLOW.length - 1 ? (
                <div className={cn("absolute right-[-4px] top-1/2 -translate-y-1/2 z-10 w-2 h-2 rounded-full border", isDark ? "border-white/10 bg-[#0f0d1a]" : "border-slate-200 bg-white")} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
