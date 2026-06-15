import type { JourneyProtocolModel } from "../../presentation/checkout-experience-model.js";
import { cn } from "../../hooks/checkout-presentation.js";

export function JourneyProtocol({ model }: { model: JourneyProtocolModel }) {
  const stepIndex = Number(model.currentNumber);
  const stepCount = model.steps.length;

  return (
    <section
      className="aacp-stage-progress aacp-flow-rail aacp-journey-protocol"
      aria-label="Progresso do checkout"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={stepCount}
      aria-valuenow={stepIndex}
      aria-valuetext={model.valueText}
    >
      <div className="aacp-stage-progress-body">
        <div className="aacp-stage-progress-head">
          <div className="aacp-stage-progress-lead">
            <span className="aacp-stage-progress-index" aria-hidden="true">
              {model.currentNumber}
            </span>
            <div className="aacp-stage-progress-current">
              <strong className="aacp-stage-progress-title">{model.currentLabel}</strong>
              <span className="aacp-stage-progress-kicker">
                Etapa {stepIndex} de {stepCount}
              </span>
            </div>
          </div>
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
                <span className="aacp-stage-progress-label">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <span className="aacp-stage-progress-status" aria-hidden="true">
          <span className="aacp-stage-progress-status-dot" />
          Agora
        </span>
      </div>
      <span className="aacp-stage-progress-shine" aria-hidden="true" />
    </section>
  );
}
