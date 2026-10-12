import type { Draft } from "./draft.js";

export interface ValidationErrors {
  idleSeconds?: string;
  cooldownSeconds?: string;
  maxInterventionsPerSession?: string;
}

export function validateIdleSeconds(seconds: number): string | undefined {
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600)
    return "Informe um número inteiro entre 10 e 3.600 segundos.";
  return undefined;
}

export function validate(d: Draft): ValidationErrors {
  const errors: ValidationErrors = {};
  const idleError = validateIdleSeconds(d.idleSeconds);
  if (idleError) errors.idleSeconds = idleError;
  if (d.cooldownSeconds < 30) errors.cooldownSeconds = "Mínimo: 30 segundos.";
  if (d.maxInterventionsPerSession > 10 || d.maxInterventionsPerSession < 1)
    errors.maxInterventionsPerSession = "Entre 1 e 10.";
  return errors;
}
