import { cn, resolveStepperProgressPct, STAGE_FLOW } from "../../hooks/checkout-view-model.js";

export function CheckoutStageProgress({ activeStage }: { activeStage: string }) {
  const activeIndex = Math.max(0, STAGE_FLOW.findIndex((step) => step.key === activeStage));
  const current = STAGE_FLOW[activeIndex] ?? STAGE_FLOW[0];
  const progressPct = resolveStepperProgressPct(activeIndex, STAGE_FLOW.length);

  return (
    <div
      className="aacp-stage-progress aacp-flow-rail"
      aria-label="Progresso do checkout"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STAGE_FLOW.length}
      aria-valuenow={activeIndex + 1}
      aria-valuetext={`${current.label}, etapa ${activeIndex + 1} de ${STAGE_FLOW.length}`}
    >
      <div className="aacp-stage-progress-head aacp-stage-progress-head--indented">
        <span className="aacp-stage-progress-kicker">
          Sua jornada
        </span>
        <span className="aacp-stage-progress-current">
          <strong className="aacp-stage-progress-title">{current.label}</strong>
          <span>Etapa {activeIndex + 1} de {STAGE_FLOW.length}</span>
        </span>
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
