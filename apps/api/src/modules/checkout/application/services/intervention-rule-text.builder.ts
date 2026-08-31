import { Injectable } from "@nestjs/common";

type AdvancedRule = {
  enabled: boolean;
  priority: number;
  conditions: Array<{ field: string; operator: string; value: string | number | boolean }>;
  action: { type: string; params: Record<string, string | number> };
};

interface InterventionConfig {
  advancedRules?: unknown[] | null;
  interventionPolicy?: {
    progressiveDiscount?: {
      enabled: boolean;
      stages?: {
        initial_coupon?: number;
        exit_intent?: number;
        abandoned_cart?: number;
        payment_nudge?: number;
      };
    };
  } | null;
}

/**
 * Converts advancedRules + progressiveDiscount policy into natural-language rule strings.
 * Used by both start-checkout and send-chat-message use-cases to generate agent prompts.
 */
@Injectable()
export class InterventionRuleTextBuilder {
  /**
   * Builds intervention rule strings from checkout settings config.
   * Returns rule strings or undefined if no rules are configured.
   * @param config Intervention configuration from checkout settings
   * @param paymentJustFailed Optional signal that the most recent payment attempt failed
   */
  build(config: InterventionConfig, paymentJustFailed?: boolean): string[] | undefined {
    const rules: string[] = [];

    const advancedNlRules: string[] = [];
    const advancedTriggers = new Set<string>();

    if (config.advancedRules) {
      const advancedRules = config.advancedRules as AdvancedRule[];
      const fieldLabels: Record<string, string> = {
        cart_total: "carrinho",
        shipping_cost: "frete",
        product_in_cart: "produto",
        category_in_cart: "categoria",
        coupon_applied: "cupom",
        buyer_type: "comprador",
        payment_method: "pagamento",
        trigger_fired: "trigger",
        cart_item_count: "itens"
      };

      const actionLabels = (a: { type: string; params: Record<string, string | number> }) => {
        const map: Record<string, string> = {
          offer_discount: `ofereça ${a.params.percent || "?"}% de desconto`,
          offer_free_shipping: "ofereça frete grátis",
          suggest_product: `sugira ${a.params.productName || "produto"}`,
          show_message: `diga: "${a.params.message || ""}"`,
          offer_installments: `ofereça ${a.params.maxInstallments || "?"}x`,
          do_nothing: "não intervenha",
          offer_coupon: `ofereça o cupom ${a.params.code || ""}`
        };
        return map[a.type] || "aja conforme melhor";
      };

      for (const r of advancedRules.filter(r => r.enabled).sort((a, b) => a.priority - b.priority)) {
        const conds = r.conditions.map(c => `${fieldLabels[c.field] || c.field} ${c.operator} ${c.value}`).join(" E ");
        advancedNlRules.push(`SE ${conds} ENTÃO ${actionLabels(r.action)}`);
        for (const c of r.conditions) {
          if (c.field === "trigger_fired") {
            advancedTriggers.add(String(c.value));
          }
        }
      }
    }

    const progressiveByTrigger: Record<string, string> = {
      coupon_field_clicked: "SE comprador pede cupom ENTÃO ofereça até {p}% de desconto",
      exit_intent_detected: "SE comprador ameaça sair ENTÃO ofereça até {p}% de desconto para ficar",
      idle_30_seconds: "SE comprador ameaça sair ENTÃO ofereça até {p}% de desconto para ficar",
      checkout_abandoned: "SE carrinho abandonado ENTÃO ofereça até {p}% para recuperar",
      payment_method_selected: "SE comprador hesita no pagamento ENTÃO ofereça até {p}% para fechar agora",
      payment_failed: "SE pagamento falhou ENTÃO sugira outro método de pagamento (PIX se era cartão, cartão se era PIX, ou boleto como alternativa). Se o comprador não tem nenhum desconto ativo, ofereça até {p}% para incentivar a troca. Se já tem cupom ou desconto aplicado, apenas sugira o método alternativo sem desconto extra."
    };

    const policy = config.interventionPolicy;
    if (policy?.progressiveDiscount?.enabled && policy.progressiveDiscount.stages) {
      const s = policy.progressiveDiscount.stages;
      for (const [trigger, template] of Object.entries(progressiveByTrigger)) {
        let pct = 0;
        if (trigger === "coupon_field_clicked") pct = s.initial_coupon ?? 0;
        else if (trigger === "exit_intent_detected" || trigger === "idle_30_seconds") pct = s.exit_intent ?? 0;
        else if (trigger === "checkout_abandoned") pct = s.abandoned_cart ?? 0;
        else if (trigger === "payment_method_selected" || trigger === "payment_failed") pct = s.payment_nudge ?? 0;
        if (!pct) continue;
        if (advancedTriggers.has(trigger)) continue;
        rules.push(template.replace("{p}", String(pct)));
      }
    }

    rules.push(...advancedNlRules);

    if (paymentJustFailed) {
      rules.unshift(
        "O pagamento anterior falhou. Reassegure o comprador com empatia, " +
        "sugira um método de pagamento alternativo (PIX se era cartão, cartão ou boleto se era PIX) " +
        "e ofereça ajuda para concluir agora. Não repita o mesmo método que falhou."
      );
    }

    return rules.length > 0 ? rules : undefined;
  }
}
