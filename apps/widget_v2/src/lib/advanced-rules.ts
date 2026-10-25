import type { CartItem } from "@/api/checkout-session";

export interface RuleCondition {
  field: string;
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "contains"
    | "in";
  value: unknown;
}

export interface RuleAction {
  type:
    | "show_free_shipping_badge"
    | "apply_loyalty_discount"
    | "show_urgency"
    | "hide_field"
    | "show_field"
    | "custom_message";
  value?: unknown;
  message?: string;
}

export interface AdvancedRule {
  condition: RuleCondition;
  action: RuleAction;
}

interface RuleContext {
  cart: { items: CartItem[]; total: number };
  buyer: { isReturning?: boolean; purchaseCount?: number };
  session: { stage?: string };
}

function evaluateCondition(
  condition: RuleCondition,
  context: RuleContext
): boolean {
  const fieldValue = getFieldValue(condition.field, context);
  switch (condition.operator) {
    case "eq":
      return fieldValue === condition.value;
    case "neq":
      return fieldValue !== condition.value;
    case "gt":
      return Number(fieldValue) > Number(condition.value);
    case "gte":
      return Number(fieldValue) >= Number(condition.value);
    case "lt":
      return Number(fieldValue) < Number(condition.value);
    case "lte":
      return Number(fieldValue) <= Number(condition.value);
    case "contains":
      return String(fieldValue).includes(String(condition.value));
    case "in":
      return (
        Array.isArray(condition.value) &&
        condition.value.includes(fieldValue)
      );
    default:
      return false;
  }
}

function getFieldValue(field: string, context: RuleContext): unknown {
  const parts = field.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function evaluateRules(
  rules: AdvancedRule[],
  context: RuleContext
): RuleAction[] {
  return rules
    .filter((rule) => evaluateCondition(rule.condition, context))
    .map((rule) => rule.action);
}
