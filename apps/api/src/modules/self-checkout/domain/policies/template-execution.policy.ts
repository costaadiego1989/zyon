export interface TemplateExecutionInput {
  accepted_payment_brands: string[];
  allowed_shipping_regions: string[];
  payment_brand: string;
  delivery_state: string;
  items_in_stock: boolean;
}

export interface TemplateExecutionResult {
  allowed: boolean;
  reason?: "PAYMENT_TYPE_REJECTED" | "REGION_NOT_ALLOWED" | "OUT_OF_STOCK";
}

export function evaluateTemplateExecution(input: TemplateExecutionInput): TemplateExecutionResult {
  if (input.accepted_payment_brands.length > 0 && !input.accepted_payment_brands.includes(input.payment_brand)) {
    return { allowed: false, reason: "PAYMENT_TYPE_REJECTED" };
  }
  if (input.allowed_shipping_regions.length > 0 && !input.allowed_shipping_regions.includes(input.delivery_state)) {
    return { allowed: false, reason: "REGION_NOT_ALLOWED" };
  }
  if (!input.items_in_stock) {
    return { allowed: false, reason: "OUT_OF_STOCK" };
  }
  return { allowed: true };
}
