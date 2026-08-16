import type { Draft } from "./draft.js";

export interface ValidationErrors {
  cooldownSeconds?: string;
  maxInterventionsPerSession?: string;
}

export function validate(d: Draft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (d.cooldownSeconds < 30) errors.cooldownSeconds = "Mínimo: 30 segundos.";
  if (d.maxInterventionsPerSession > 10 || d.maxInterventionsPerSession < 1)
    errors.maxInterventionsPerSession = "Entre 1 e 10.";
  return errors;
}
