import React from "react";
import { Rocket } from "lucide-react";
import { Button } from "../../../components/Button.js";

interface StepFooterProps {
  currentStep: number;
  totalSteps: number;
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}

export function StepFooter({ currentStep, totalSteps, busy, onBack, onNext, nextLabel, nextDisabled }: StepFooterProps) {
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

      <Button variant="primary" arrow={!isLast} disabled={busy || nextDisabled} loading={busy} onClick={onNext}>
        {nextLabel ?? (isLast ? (
          <>
            <Rocket size={15} style={{ marginRight: 8 }} />
            Concluir configuração
          </>
        ) : (
          "Continuar"
        ))}
      </Button>
    </footer>
  );
}
