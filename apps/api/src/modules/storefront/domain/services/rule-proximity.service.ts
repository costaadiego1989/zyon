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

import { ruleReward, conditionNotice, formatRuleMoney } from "./advanced-rule-notices.js";

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


export class RuleProximityEngine {
  private readonly evaluator = new AdvancedRuleEvaluator();

  compute(advancedRules: AdvancedRule[], ctx: RuleMatchContext, appliedRuleId?: string,
    applied?: { discountCents: number; freeShipping: boolean }): ProximityResult {
    const details = this.evaluator.evaluateAll(advancedRules, ctx);
    const winner = details.find(({ matched }) => matched)?.rule;
    const active: ActiveRuleBadge[] = [];
    const all: RuleNudge[] = [];
    for (const { rule, matched } of details) {
      const reward = ruleReward(rule);
      if (!reward) continue;
      if (matched) {
        if (appliedRuleId && rule.id === appliedRuleId) {
          if (applied?.discountCents) active.push({ ruleId: rule.id, message: `${formatRuleMoney(applied.discountCents / 100)} de desconto aplicado` });
          else if (applied?.freeShipping) active.push({ ruleId: rule.id, message: "Frete grátis aplicado" });
          else if (!applied) active.push({ ruleId: rule.id, message: `${reward} aplicado` });
        } else if (rule === winner && !["offer_discount", "offer_free_shipping"].includes(rule.action.type)) {
          active.push({ ruleId: rule.id, message: reward });
        }
        continue;
      }
      if (winner && winner.priority <= rule.priority) continue;
      const unmet = rule.conditions.filter((c) => !this.evaluator.checkCondition(c, ctx));
      const cond = unmet[0];
      if (!cond) continue;
      // An isolated gap is truthful only if every other condition already holds.
      if (unmet.length === 1 && [">", ">=", "gt", "gte"].includes(cond.operator)) {
        const strict = [">", "gt"].includes(cond.operator);
        const target = Number(cond.value);
        if (Number.isFinite(target) && cond.field === "cart_total") {
          const targetCents = strict ? Math.floor(target * 100) + 1 : Math.ceil(target * 100);
          const gap = Math.max(0, targetCents - Math.round(ctx.cartTotal * 100)) / 100;
          if (gap > 0) all.push({ ruleId: rule.id, kind: "cart_total", gap, message: `Faltam ${formatRuleMoney(gap)} para ${reward}`, reachable: true });
          continue;
        }
        if (Number.isFinite(target) && cond.field === "cart_item_count") {
          const gap = Math.max(0, (strict ? Math.floor(target) + 1 : Math.ceil(target)) - ctx.cartItemCount);
          if (gap > 0) all.push({ ruleId: rule.id, kind: "cart_item_count", gap, message: `Adicione mais ${gap} ${gap === 1 ? "item" : "itens"} para ${reward}`, reachable: true });
          continue;
        }
      }
      all.push({ ruleId: rule.id, kind: "conditional", message: `Condição para ${reward}: ${unmet.map(conditionNotice).join(" e ")}.`, reachable: false });
    }
    // Compare monetary gaps only to other monetary gaps; honor rule priority across kinds.
    const ranked = [...all].sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      return a.kind === b.kind ? (a.gap ?? Infinity) - (b.gap ?? Infinity) : 0;
    });
    return { active, nextNudge: ranked[0] ?? null, all };
  }
}
