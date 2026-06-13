import { Check } from "lucide-react";
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
      <div className="aacp-stage-progress-head aacp-stage-progress-head--indented">
        <span className="aacp-stage-progress-kicker">
          <span aria-hidden="true">Etapa {model.currentNumber}</span>
          <span className="aacp-sr-only">{model.valueText}</span>
        </span>
        <span className="aacp-stage-progress-current">
          <strong className="aacp-stage-progress-title">{model.currentLabel}</strong>
          <span>Jornada de compra</span>
        </span>
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
                {step.status === "done" ? <Check size={10} strokeWidth={2.4} /> : null}
              </span>
              <span className="aacp-stage-progress-label">{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
