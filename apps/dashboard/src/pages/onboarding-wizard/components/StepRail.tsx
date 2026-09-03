import React from "react";
import { Check, type LucideIcon } from "lucide-react";

interface StepMeta {
  id: number;
  label: string;
  caption: string;
  icon: LucideIcon;
}

interface StepRailProps {
  steps: StepMeta[];
  currentStep: number;
  onStepClick?: (step: number) => void;
  progress?: number;
}

export function StepRail({ steps, currentStep, onStepClick, progress }: StepRailProps) {
  return (
    <aside className="onb-rail" aria-label="Progresso do onboarding">
      <div className="onb-rail-head">
        <div>
          <strong>Ative seu checkout assistido</strong>
          <small>Configure tudo em poucos minutos. Você pode alterar qualquer configuração depois.</small>
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
              onClick={() => onStepClick?.(step.id)}
              role={onStepClick ? "button" : undefined}
              tabIndex={onStepClick ? 0 : undefined}
              onKeyDown={onStepClick ? (e) => { if (e.key === "Enter" || e.key === " ") onStepClick(step.id); } : undefined}
            >
              <span className="onb-rail-node" aria-hidden="true">
                {state === "done" ? <Check size={14} strokeWidth={3} /> : <Icon size={15} strokeWidth={2} />}
              </span>
              <span className="onb-rail-text">
                <span className="onb-rail-index">
                  Etapa {String(step.id).padStart(2, "0")}
                  {state === "done" ? " · concluída" : state === "active" ? " · atual" : ""}
                </span>
                <span className="onb-rail-label">{step.label}</span>
                <span className="onb-rail-caption">{step.caption}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
