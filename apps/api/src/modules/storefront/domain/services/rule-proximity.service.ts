/**
 * Rule proximity engine — "almost there" nudges.
 *
 * For every enabled rule that has NOT matched yet, computes how close the cart
 * is to unlocking it and produces a contextual nudge ("Faltam R$40 para frete
 * grátis"). Pure domain service: deterministic, no I/O, no LLM. The LLM only
 * narrates the chosen nudge; it never computes the gap.
 *
 * Selection: among unmet rules, the one with the SMALLEST reachable gap is
 * surfaced first (most attainable → highest conversion lift), so the buyer sees
 * a single, actionable "almost there" message rather than a wall of conditions.
 */

import {
  AdvancedRuleEvaluator,
  type AdvancedRule,
  type RuleMatchContext,
} from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";

export type NudgeKind = "cart_total" | "cart_item_count" | "conditional" | "progressive";

export interface RuleNudge {
  ruleId?: string;
  kind: NudgeKind;
  /** Numeric gap when applicable: reais for cart_total, item count for cart_item_count. */
  gap?: number;
  /** Ready-to-render message. */
  message: string;
  /** True when a concrete numeric gap exists (cart_total / cart_item_count / progressive). */
  reachable: boolean;
}

export interface ActiveRuleBadge {
  ruleId?: string;
  message: string;
}

export interface ProximityResult {
  /** Rules already satisfied — render as confirmations ("✅ 15% aplicado"). */
  active: ActiveRuleBadge[];
  /** The single best next nudge (smallest reachable gap), or null. */
  nextNudge: RuleNudge | null;
  /** All computed nudges (for callers that want the full list). */
  all: RuleNudge[];
}

const ACTION_LABEL: Record<string, (params: Record<string, string | number | boolean>) => string> = {
  offer_discount: (p) => `${p.percent ?? "?"}% de desconto`,
  offer_free_shipping: () => "frete grátis",
  offer_coupon: (p) => `o cupom ${p.code ?? ""}`.trim(),
  offer_installments: (p) => `${p.maxInstallments ?? "?"}x sem juros`,
};

function actionReward(action: AdvancedRule["action"]): string {
  const fn = ACTION_LABEL[action.type];
  return fn ? fn(action.params) : "um benefício";
}

const BRL = (reais: number) =>
  reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export class RuleProximityEngine {
  private readonly evaluator = new AdvancedRuleEvaluator();

  compute(advancedRules: AdvancedRule[], ctx: RuleMatchContext): ProximityResult {
    const details = this.evaluator.evaluateAll(advancedRules, ctx);

    const active: ActiveRuleBadge[] = [];
    const all: RuleNudge[] = [];

    for (const { rule, matched } of details) {
      if (matched) {
        active.push({ ruleId: rule.id, message: `✅ ${capitalize(actionReward(rule.action))} aplicado` });
        continue;
      }
      const nudge = this.nudgeForRule(rule, ctx);
      if (nudge) all.push(nudge);
    }

    // Best next nudge: reachable ones ranked by smallest gap; conditional (no
    // numeric gap) rank last so a concrete "almost there" always wins.
    const ranked = [...all].sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      return (a.gap ?? Infinity) - (b.gap ?? Infinity);
    });

    return { active, nextNudge: ranked[0] ?? null, all };
  }

  /**
   * Compute the nudge for a single unmet rule. Only the FIRST unmet numeric
   * condition drives the gap (cart_total or cart_item_count); binary/category
   * conditions produce a conditional hint with no gap.
   */
  private nudgeForRule(rule: AdvancedRule, ctx: RuleMatchContext): RuleNudge | null {
    const reward = actionReward(rule.action);

    for (const cond of rule.conditions) {
      // Skip conditions already satisfied — the gap is on the unmet one.
      if (this.evaluator.checkCondition(cond, ctx)) continue;

      const target = Number(cond.value);
      if (cond.field === "cart_total" && Number.isFinite(target) && isLowerBound(cond.operator)) {
        const gap = Math.max(0, target - ctx.cartTotal);
        if (gap <= 0) continue;
        return {
          ruleId: rule.id,
          kind: "cart_total",
          gap,
          message: `Faltam ${BRL(gap)} para ${reward}`,
          reachable: true,
        };
      }

      if (cond.field === "cart_item_count" && Number.isFinite(target) && isLowerBound(cond.operator)) {
        const gap = Math.max(0, Math.ceil(target - ctx.cartItemCount));
        if (gap <= 0) continue;
        const unit = gap === 1 ? "item" : "itens";
        return {
          ruleId: rule.id,
          kind: "cart_item_count",
          gap,
          message: `Adicione mais ${gap} ${unit} e ganhe ${reward}`,
          reachable: true,
        };
      }

      // Binary / categorical conditions (buyer_type, payment_method,
      // category_in_cart, coupon_applied): no continuous gap → conditional hint.
      const hint = conditionalHint(cond.field, cond.value, reward);
      if (hint) {
        return { ruleId: rule.id, kind: "conditional", message: hint, reachable: false };
      }
    }
    return null;
  }
}

/** Operators that mean "cart must reach at least this value" → a gap makes sense. */
function isLowerBound(operator: string): boolean {
  const op = operator.trim().toLowerCase();
  return op === ">" || op === ">=" || op === "gt" || op === "gte";
}

function conditionalHint(field: string, value: unknown, reward: string): string | null {
  switch (field) {
    case "payment_method":
      return `Pague com ${String(value).toUpperCase()} e ganhe ${reward}`;
    case "buyer_type":
      return `Clientes ${String(value)} ganham ${reward}`;
    case "category_in_cart":
      return `Adicione um produto de ${String(value)} e ganhe ${reward}`;
    default:
      return null;
  }
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
