import { DashboardHttpError } from "../../../api-client.js";

export type ValidationResult =
  | { valid: true }
  | { valid: false; field: string; message: string };

export type ThemeDraft = {
  accentColor: string;
  logoUrl?: string;
  headerTitle?: string;
  agentName?: string;
};

export type RulesDraft = {
  maxDiscountPercent: number;
  minimumMarginPercent: number;
  allowFreeShipping: boolean;
};

export type CheckoutDraft = {
  mode: string;
  openWidgetOnTrigger: boolean;
};

export function isValidHexColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "blob:";
  } catch {
    return false;
  }
}

export function validateThemeDraft(draft: ThemeDraft): ValidationResult[] {
  const errors: ValidationResult[] = [];
  if (!(draft.headerTitle ?? "").trim()) {
    errors.push({ valid: false, field: "headerTitle", message: "Nome da loja é obrigatório" });
  }
  if (!(draft.agentName ?? "").trim()) {
    errors.push({ valid: false, field: "agentName", message: "Nome do agente é obrigatório" });
  }
  if (draft.logoUrl && !isValidUrl(draft.logoUrl)) {
    errors.push({ valid: false, field: "logoUrl", message: "URL do logotipo inválida" });
  }
  if (!isValidHexColor(draft.accentColor)) {
    errors.push({ valid: false, field: "accentColor", message: "Cor inválida" });
  }
  return errors;
}

export function validateRulesDraft(draft: RulesDraft): ValidationResult[] {
  const errors: ValidationResult[] = [];
  if (draft.maxDiscountPercent < 0 || draft.maxDiscountPercent > 30) {
    errors.push({ valid: false, field: "maxDiscountPercent", message: "Deve ser entre 0% e 30%" });
  }
  if (draft.minimumMarginPercent < 0 || draft.minimumMarginPercent > 100) {
    errors.push({ valid: false, field: "minimumMarginPercent", message: "Deve ser entre 0% e 100%" });
  }
  if (draft.minimumMarginPercent <= draft.maxDiscountPercent) {
    errors.push({ valid: false, field: "minimumMarginPercent", message: "Margem mínima deve ser maior que o desconto máximo" });
  }
  return errors;
}

export function validateCheckoutDraft(_draft: CheckoutDraft): ValidationResult[] {
  return [];
}

export function friendlyError(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    if (e.status === 401) return "Sessão expirada. Faça login novamente.";
    if (e.status === 422) return "Dados inválidos. Verifique os campos.";
    if (e.status >= 500) return "Erro no servidor. Tente novamente.";
  }
  if (e instanceof Error) return "Erro inesperado. Tente novamente.";
  return "Erro inesperado. Tente novamente.";
}
