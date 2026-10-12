import { reaisToCents } from "../../../utils/currency.js";
import type { ProductVariantDraft } from "../hooks/useVariantManager.js";
import { foodOptionsError } from "./food-options-validation.js";
import { serviceScheduleFormError } from "./service-schedule-validation.js";

export function validMoneyInput(value: string): boolean {
  return /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(value.trim()) && reaisToCents(value) <= 2_147_483_647;
}

export function parseInteger(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return /^\+?\d+$/.test(value.trim()) && Number.isSafeInteger(n) && n <= 2_147_483_647 ? n : null;
}

export function parseFloatSafe(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validateVariants(variants: ProductVariantDraft[], productType?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (variants.length === 0) {
    errors["variants"] = "Adicione pelo menos uma variante";
    return errors;
  }
  const requiresWeight = productType === "physical" || !productType;
  const seenSkus = new Set<string>();
  variants.forEach((v, idx) => {
    if (!v.sku.trim()) errors[`variant_${idx}_sku`] = "SKU obrigatório";
    else if (seenSkus.has(v.sku.trim())) errors[`variant_${idx}_sku`] = "SKU duplicado";
    else seenSkus.add(v.sku.trim());

    const price = reaisToCents(v.basePriceInput);
    if (!validMoneyInput(v.basePriceInput) || price <= 0) errors[`variant_${idx}_price`] = "Preço inválido";

    if (requiresWeight && !v.weightInput.trim()) {
      errors[`variant_${idx}_weight`] = "Peso obrigatório para produtos físicos";
    } else if (v.weightInput.trim()) {
      const w = parseFloatSafe(v.weightInput);
      if (w === null || w < 0 || (requiresWeight && w === 0)) errors[`variant_${idx}_weight`] = "Peso inválido";
    }

    if (v.costInput.trim()) {
      const c = reaisToCents(v.costInput);
      if (!validMoneyInput(v.costInput) || c < 0) errors[`variant_${idx}_cost`] = "Custo inválido";
    }
    if (v.stockInput.trim() && parseInteger(v.stockInput) === null) errors[`variant_${idx}_stock`] = "Estoque deve ser um inteiro maior ou igual a zero";
  });
  return errors;
}

export function validateSimpleProduct(variant: ProductVariantDraft, productType?: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!variant.sku.trim()) errors["simple_sku"] = "SKU obrigatório";
  const price = reaisToCents(variant.basePriceInput);
  if (!validMoneyInput(variant.basePriceInput) || price <= 0) errors["simple_price"] = "Preço inválido";
  const requiresWeight = productType === "physical" || !productType;
  if (requiresWeight && !variant.weightInput.trim()) {
    errors["simple_weight"] = "Peso obrigatório para produtos físicos";
  } else if (variant.weightInput.trim()) {
    const w = parseFloatSafe(variant.weightInput);
    if (w === null || w < 0 || (requiresWeight && w === 0)) errors["simple_weight"] = "Peso inválido";
  }
  if (variant.costInput.trim()) {
    const c = reaisToCents(variant.costInput);
    if (!validMoneyInput(variant.costInput) || c < 0) errors["simple_cost"] = "Custo inválido";
  }
  if (variant.stockInput.trim() && parseInteger(variant.stockInput) === null) errors["simple_stock"] = "Estoque deve ser um inteiro maior ou igual a zero";
  return errors;
}

export function validateProductMetadata(type: string, metadata: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (type === "food") {
    const foodError = foodOptionsError(metadata.optionGroups);
    if (foodError) errors.optionGroups = foodError;
  }
  if (type === "digital" && metadata.downloadUrl) {
    try {
      const url = new URL(String(metadata.downloadUrl));
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { errors.downloadUrl = "Informe um link HTTPS válido para download"; }
  }
  if (type === "service") {
    const scheduleError = serviceScheduleFormError(metadata.serviceSchedule);
    if (scheduleError) errors.serviceSchedule = scheduleError;
    const values = [metadata.startDate, metadata.startTime, metadata.endDate, metadata.endTime];
    if (values.some(Boolean)) {
      if (!values.every(value => typeof value === "string" && value.length > 0)) errors.serviceInterval = "Preencha as datas e os horários de início e fim";
      else {
        const [startDate, startTime, endDate, endTime] = values as string[];
        const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
        const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (!validDate(startDate!) || !validDate(endDate!) || !validTime(startTime!) || !validTime(endTime!)) errors.serviceInterval = "Informe datas e horários válidos";
        else if (`${endDate}T${endTime}` <= `${startDate}T${startTime}`) errors.serviceInterval = "O fim do serviço deve ser posterior ao início";
      }
    }
  }
  return errors;
}
