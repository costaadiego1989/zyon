import React from "react";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";

interface StepFooterProps {
  currentStep: number;
  totalSteps: number;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function StepFooter({ currentStep, totalSteps, busy, onBack, onNext }: StepFooterProps) {
  const isLast = currentStep === totalSteps;

  return (
    <footer className="onb-footer">
      <div className="onb-footer-left">
        {currentStep > 1 ? (
          <button type="button" className="onb-back" disabled={busy} onClick={onBack}>
            <ArrowLeft size={15} />
            Voltar
          </button>
        ) : (
          <span className="onb-footer-hint">Etapa {currentStep} de {totalSteps}</span>
        )}
      </div>

      <button type="button" className="onb-cta" disabled={busy} onClick={onNext}>
        <span className="onb-cta-face">
          {isLast ? <Rocket size={15} /> : null}
          {busy
            ? isLast ? "Finalizando..." : "Salvando..."
            : isLast ? "Finalizar" : "Continuar"}
          {!busy && !isLast ? <ArrowRight size={15} /> : null}
        </span>
      </button>
    </footer>
  );
}
