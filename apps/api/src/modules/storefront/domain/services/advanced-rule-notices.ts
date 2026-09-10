import type { AdvancedRule, RuleCondition } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

export interface RuleNotice { ruleId?: string; message: string }
export const formatRuleMoney = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Describe offers as conditional; only the pricing engine can confirm application. */
export function ruleReward(rule: AdvancedRule): string | null {
  const p = rule.action.params;
  switch (rule.action.type) {
    case "offer_discount": {
      const percent = Number(p.percent);
      if (!Number.isFinite(percent) || percent <= 0 || Number(p.maxDiscountReais) === 0) return null;
      return `até ${percent}% de desconto no carrinho${p.maxDiscountReais != null ? ` (limite de ${formatRuleMoney(Number(p.maxDiscountReais))})` : ""}`;
    }
    case "offer_free_shipping": return "frete grátis";
    case "offer_coupon": return p.code ? `cupom ${String(p.code)} (validação no carrinho)` : null;
    case "offer_installments": return Number(p.maxInstallments) > 1 ? `opção de até ${p.maxInstallments} parcelas, conforme o pagamento` : null;
    case "suggest_product": return p.productName ? `sugestão: ${String(p.productName)}` : null;
    case "show_message": return p.message ? String(p.message) : null;
    default: return null;
  }
}

export function conditionNotice(c: RuleCondition): string {
  const ops: Record<string, string> = { ">": "acima de", gt: "acima de", ">=": "a partir de", gte: "a partir de", "<": "abaixo de", lt: "abaixo de", "<=": "até", lte: "até", "==": "igual a", eq: "igual a", is: "igual a" };
  const op = ops[c.operator.trim().toLowerCase()] ?? "compatível com";
  switch (c.field) {
    case "cart_total": return `valor dos produtos no carrinho ${op} ${formatRuleMoney(Number(c.value))}`;
    case "shipping_cost": return `frete ${op} ${formatRuleMoney(Number(c.value))}`;
    case "cart_item_count": return `quantidade total no carrinho ${op} ${c.value} itens`;
    case "product_in_cart": return "com os produtos elegíveis no carrinho";
    case "category_in_cart": return "com produtos da categoria elegível no carrinho";
    case "coupon_applied": return String(c.value) === "true" ? "com cupom aplicado" : "sem cupom aplicado";
    case "payment_method": {
      const names: Record<string, string> = { pix: "Pix", card: "cartão", credit_card: "cartão de crédito", boleto: "boleto", crypto: "cripto" };
      return `pagamento ${op} ${names[String(c.value)] ?? "uma modalidade elegível"}`;
    }
    case "buyer_type": return `para ${({ new: "novos clientes", returning: "clientes recorrentes" } as Record<string, string>)[String(c.value)] ?? "clientes elegíveis"}`;
    case "trigger_fired": return "quando a condição de atendimento configurada ocorrer";
    default: return "conforme as condições da oferta";
  }
}

export function productRuleNotices(rules: AdvancedRule[], skus: string[], productId?: string): RuleNotice[] {
  return rules.filter((rule) => rule.enabled && (rule.productId ? rule.productId === productId : rule.conditions.some((c) =>
    c.field === "product_in_cart" && c.operator === "contains" && (Array.isArray(c.value) ? c.value : [String(c.value)]).some((sku) => skus.includes(sku))
  ))).sort((a, b) => a.priority - b.priority).flatMap((rule) => {
    const reward = ruleReward(rule);
    if (!reward) return [];
    // Retain every condition, including product/category requirements. Product rules
    // operate on cart totals/counts, so never advertise a per-item discount.
    const when = rule.conditions.map(conditionNotice).join(" e ");
    return [{ ruleId: rule.id, message: `Se ${when}: ${reward}.${rule.action.type === "offer_discount" ? " Sujeito aos limites de desconto da loja." : ""}` }];
  });
}
