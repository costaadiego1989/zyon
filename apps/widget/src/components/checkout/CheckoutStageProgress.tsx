import { cn, STAGE_FLOW } from "../../hooks/checkout-view-model.js";

export function CheckoutStageProgress({ activeStage }: { activeStage: string }) {
  const activeIndex = Math.max(0, STAGE_FLOW.findIndex((step) => step.key === activeStage));
  const current = STAGE_FLOW[activeIndex] ?? STAGE_FLOW[0];
  const progressPct = (activeIndex / Math.max(STAGE_FLOW.length - 1, 1)) * 100;

  return (
    <div className="aacp-stage-progress" aria-label="Progresso do checkout">
      <div className="aacp-stage-progress-head aacp-stage-progress-head--indented">
        <span className="aacp-stage-progress-kicker">
          Etapa {activeIndex + 1} de {STAGE_FLOW.length}
        </span>
        <strong className="aacp-stage-progress-title">{current.label}</strong>
      </div>

      <div className="aacp-stage-progress-bar" aria-hidden>
        <div className="aacp-stage-progress-bar-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="aacp-stage-progress-rail-wrap">
        <div className="aacp-stage-progress-track" aria-hidden>
          <div className="aacp-stage-progress-track-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <ol className="aacp-stage-progress-steps">
          {STAGE_FLOW.map((step, index) => {
            const status = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";

            return (
              <li key={step.key} className={cn("aacp-stage-progress-step", status)}>
                <span
                  className="aacp-stage-progress-dot"
                  aria-current={status === "active" ? "step" : undefined}
                />
                <span className="aacp-stage-progress-label">{step.shortLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
