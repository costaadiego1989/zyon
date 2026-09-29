export interface BudgetSettings {
  enabled: boolean;
  email: string;
  whatsapp: string;
}

export interface BudgetErrors {
  email?: string;
  whatsapp?: string;
}

export function readBudgetSettings(settings: Record<string, unknown>): BudgetSettings | null {
  const value = settings.budget;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const budget = value as Record<string, unknown>;
  if (typeof budget.enabled !== "boolean") return null;
  if (budget.email != null && typeof budget.email !== "string") return null;
  if (budget.whatsapp != null && typeof budget.whatsapp !== "string") return null;
  return { enabled: budget.enabled, email: (budget.email as string | undefined) ?? "", whatsapp: (budget.whatsapp as string | undefined) ?? "" };
}

export function validateBudgetSettings(budget: BudgetSettings): BudgetErrors {
  const errors: BudgetErrors = {};
  const email = budget.email.trim();
  const phone = budget.whatsapp.trim();
  if (email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    errors.email = "Informe um e-mail válido ou deixe o campo vazio.";
  }
  if (phone.length > 32 || (phone && !/^\d{10,15}$/.test(phone.replace(/\D/g, "")))) {
    errors.whatsapp = "Informe o telefone com DDD, entre 10 e 15 dígitos, ou deixe o campo vazio.";
  }
  return errors;
}

export function normalizeBudgetSettings(budget: BudgetSettings): BudgetSettings {
  return { enabled: budget.enabled, email: budget.email.trim(), whatsapp: budget.whatsapp.replace(/\D/g, "") };
}
