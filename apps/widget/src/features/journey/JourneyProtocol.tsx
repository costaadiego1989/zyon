import type { JourneyProtocolModel } from "../../presentation/checkout-experience-model.js";
import { cn } from "../../hooks/checkout-presentation.js";

export function JourneyProtocol({ model }: { model: JourneyProtocolModel }) {
  const stepIndex = Number(model.currentNumber);
  const stepCount = model.steps.length;

  return (
    <section
      className="zyon-stage-progress zyon-flow-rail zyon-journey-protocol"
      aria-label="Progresso do checkout"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={stepCount}
      aria-valuenow={stepIndex}
      aria-valuetext={model.valueText}
    >
      <div className="zyon-stage-progress-body">
        <div className="zyon-stage-progress-head">
          <div className="zyon-stage-progress-lead">
            <span className="zyon-stage-progress-index" aria-hidden="true">
              {model.currentNumber}
            </span>
            <div className="zyon-stage-progress-current">
              <strong className="zyon-stage-progress-title">{model.currentLabel}</strong>
              <span className="zyon-stage-progress-kicker">
                Etapa {stepIndex} de {stepCount}
              </span>
            </div>
          </div>
          <span className="zyon-sr-only">{model.valueText}</span>
        </div>

        <div className="zyon-stage-progress-rail-wrap">
          <div className="zyon-stage-progress-track" aria-hidden="true">
            <div
              className="zyon-stage-progress-track-fill"
              style={{ width: `${model.progressPercent}%` }}
            />
          </div>
          <ol className="zyon-stage-progress-steps">
            {model.steps.map((step) => (
              <li
                key={step.key}
                className={cn("zyon-stage-progress-step", step.status)}
              >
                <span
                  className="zyon-stage-progress-dot"
                  aria-current={step.status === "active" ? "step" : undefined}
                >
                  {step.status === "done" ? (
                    <span className="zyon-stage-progress-check" aria-hidden="true" />
                  ) : null}
                </span>
                <span className="zyon-stage-progress-label">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>

        <span className="zyon-stage-progress-status" aria-hidden="true">
          <span className="zyon-stage-progress-status-dot" />
          Agora
        </span>
      </div>
      <span className="zyon-stage-progress-shine" aria-hidden="true" />
    </section>
  );
}
