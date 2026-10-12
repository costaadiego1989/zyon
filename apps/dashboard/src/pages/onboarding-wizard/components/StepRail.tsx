import React from "react";
import { Check, type LucideIcon } from "lucide-react";

interface StepMeta {
  id: number;
  label: string;
  caption: string;
  icon: LucideIcon;
  optional?: boolean;
}

interface StepRailProps {
  steps: StepMeta[];
  currentStep: number;
  onStepClick?: (step: number) => void;
  progress?: number;
}

export function StepRail({ steps, currentStep, onStepClick, progress }: StepRailProps) {
  return (
    <aside className="onb-rail" aria-label="Etapas da configuração">
      <div className="onb-rail-head">
        <div>
          <strong>Prepare sua loja</strong>
          <small>Seu rascunho fica neste navegador. Revise as etapas anteriores quando precisar.</small>
        </div>
      </div>

      <div className="onb-rail-meter" aria-hidden="true">
        <span className="onb-rail-meter-fill" style={{ transform: `scaleX(${(progress ?? 0) / 100})` }} />
      </div>

      <ol className="onb-rail-steps">
        {steps.map((step) => {
          const state = step.id < currentStep ? "done" : step.id === currentStep ? "active" : "todo";
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className={`onb-rail-step onb-rail-step-${state}`}
              aria-current={state === "active" ? "step" : undefined}
            >
              <button type="button" className="onb-rail-step-button" disabled={!onStepClick || state !== "done"} onClick={() => onStepClick?.(step.id)}>
              <span className="onb-rail-node" aria-hidden="true">
                {state === "done" ? <Check size={14} strokeWidth={3} /> : <Icon size={15} strokeWidth={2} />}
              </span>
              <span className="onb-rail-text">
                <span className="onb-rail-index">
                  Etapa {String(step.id).padStart(2, "0")}
                  {state === "done" ? " · revisada" : state === "active" ? " · atual" : ""}
                </span>
                <span className="onb-rail-label">{step.label}{step.optional && <small className="onb-optional">Opcional</small>}</span>
                <span className="onb-rail-caption">{step.caption}</span>
              </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
