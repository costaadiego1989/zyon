import React from "react";
import { Rocket } from "lucide-react";
import { Button } from "../../../components/Button.js";

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
          <Button variant="ghost" disabled={busy} onClick={onBack}>
            Voltar
          </Button>
        ) : (
          <span className="onb-footer-hint">Etapa {currentStep} de {totalSteps}</span>
        )}
      </div>

      <Button variant="primary" arrow={!isLast} disabled={busy} loading={busy} onClick={onNext}>
        {isLast ? (
          <>
            <Rocket size={15} style={{ marginRight: 8 }} />
            Finalizar
          </>
        ) : (
          "Continuar"
        )}
      </Button>
    </footer>
  );
}
