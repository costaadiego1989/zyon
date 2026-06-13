import type { JourneyProtocolModel } from "../../presentation/checkout-experience-model.js";
import { cn } from "../../hooks/checkout-view-model.js";

export function JourneyProtocol({ model }: { model: JourneyProtocolModel }) {
  return (
    <section
      className="aacp-stage-progress aacp-flow-rail aacp-journey-protocol"
      aria-label="Progresso do checkout"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={model.steps.length}
      aria-valuenow={Number(model.currentNumber)}
      aria-valuetext={model.valueText}
    >
      <div className="aacp-stage-progress-head">
        <span className="aacp-stage-progress-current">
          <span className="aacp-stage-progress-kicker">
            Etapa {model.currentNumber} · Agora
          </span>
          <strong className="aacp-stage-progress-title">{model.currentLabel}</strong>
        </span>
        <span className="aacp-sr-only">{model.valueText}</span>
      </div>

      <div className="aacp-stage-progress-rail-wrap">
        <div className="aacp-stage-progress-track" aria-hidden="true">
          <div
            className="aacp-stage-progress-track-fill"
            style={{ width: `${model.progressPercent}%` }}
          />
        </div>
        <ol className="aacp-stage-progress-steps">
          {model.steps.map((step) => (
            <li
              key={step.key}
              className={cn("aacp-stage-progress-step", step.status)}
            >
              <span
                className="aacp-stage-progress-dot"
                aria-current={step.status === "active" ? "step" : undefined}
              >
                {step.status === "done" ? (
                  <span className="aacp-stage-progress-check" aria-hidden="true" />
                ) : null}
              </span>
              <span className="aacp-stage-progress-label">
                <span className="aacp-stage-progress-step-number">
                  {String(model.steps.indexOf(step) + 1).padStart(2, "0")}
                </span>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
