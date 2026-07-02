import type { Draft } from "./draft.js";
import { ALLOWED_SUPPRESSED_STEPS, BRAZILIAN_UF_CODES } from "./constants.js";

export interface ValidationErrors {
  cooldownSeconds?: string;
  maxInterventionsPerSession?: string;
  minimumAbandonmentScore?: string;
  suppressedSteps?: string;
  blockedRegions?: string;
  handoffMessage?: string;
}

export function validate(d: Draft): ValidationErrors {
  const errors: ValidationErrors = {};

  if (d.cooldownSeconds < 30) {
    errors.cooldownSeconds = "Mínimo: 30 segundos.";
  }

  if (d.maxInterventionsPerSession < 1 || d.maxInterventionsPerSession > 10) {
    errors.maxInterventionsPerSession = "Entre 1 e 10.";
  }

  if (d.minimumAbandonmentScore < 0 || d.minimumAbandonmentScore > 1) {
    errors.minimumAbandonmentScore = "Entre 0.0 e 1.0.";
  }

  const invalidSteps = d.suppressedSteps.filter(
    (s) => !(ALLOWED_SUPPRESSED_STEPS as readonly string[]).includes(s)
  );
  if (invalidSteps.length > 0) {
    errors.suppressedSteps = `Valores inválidos: ${invalidSteps.join(", ")}`;
  }

  const invalidRegions = d.blockedRegions.filter(
    (r) => !(BRAZILIAN_UF_CODES as readonly string[]).includes(r)
  );
  if (invalidRegions.length > 0) {
    errors.blockedRegions = `Códigos UF inválidos: ${invalidRegions.join(", ")}`;
  }

  if (d.handoffEnabled && !d.handoffMessage.trim()) {
    errors.handoffMessage = "Mensagem obrigatória quando handoff está ativo.";
  }

  return errors;
}
