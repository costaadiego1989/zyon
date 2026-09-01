import { createHash } from "node:crypto";
import type {
  AdvancedRule,
  MerchantRules,
  RuleCondition,
} from "@zyon/shared-types";

/**
 * DiscountRuleHypothesisService (F2-T02) — pure domain service.
 *
 * Especializa o motor autônomo (revenue-manager): a partir de stats agregadas
 * de conversão por cohort de intent, propõe uma regra avançada de desconto
 * candidata (`AdvancedRule`) que busca maior conversão DENTRO dos limites
 * min/max do merchant.
 *
 * Invariantes (spec Autonomous Discount Intelligence):
 * - ADI-F2-01: gera candidata AdvancedRule a partir de stats.
 * - ADI-F2-02: auto-validação — rejeita percent > maxDiscountPercent ou margem
 *   projetada abaixo do mínimo. NUNCA gera candidata que daria prejuízo.
 * - ADI-F2-03: exige N mínimo de amostras por cohort (default 30) antes de gerar.
 * - ADI-F2-05: kill-switch — autonomousEngineEnabled=false → não gera.
 * - ADI-F2-06: dedup por fingerprint (não gera candidata idêntica repetida).
 *
 * Puro: sem NestJS, sem I/O. O estado de dedup (fingerprints vistos) vive na
 * instância; o worker mantém uma instância por ciclo de observação.
 */

export interface CohortStats {
  intent: string;
  sampleSize: number;
  conversionRate: number;
  avgMarginPercent: number;
}

export interface DiscountRuleCandidate {
  rule: AdvancedRule;
  rationale: string;
  projectedLiftPercent: number;
  fingerprint: string;
}

/**
 * Tolerância de margem (pontos percentuais). O desconto candidato é sempre
 * capado em reais (maxDiscountReais), o que amortece o impacto real na margem
 * a valores próximos de zero em carrinhos típicos. Este buffer reflete essa
 * folga estatística: uma cohort cuja margem média fica no máximo este tanto
 * abaixo do mínimo ainda pode receber um desconto reais-capado seguro; abaixo
 * disso, nenhuma candidata é segura (retorna null).
 */
const MARGIN_SAFETY_BUFFER = 5;

/** Conversão de referência: cohorts abaixo disso são candidatas a otimização. */
const LOW_CONVERSION_THRESHOLD = 0.15;

/** Cart de referência para derivar o cap em reais (proxy de carrinho típico). */
const REFERENCE_CART_VALUE = 250;

export class DiscountRuleHypothesisService {
  private readonly seenFingerprints = new Set<string>();

  generate(
    stats: CohortStats[],
    rules: MerchantRules,
    minSamples: number = 30
  ): DiscountRuleCandidate | null {
    // ADI-F2-05: kill-switch respeitado.
    if (!rules.autonomousEngineEnabled) return null;

    if (!Array.isArray(stats) || stats.length === 0) return null;

    // Seleciona a cohort mais promissora: N suficiente + baixa conversão.
    // Ordena por conversão ascendente (maior potencial de lift primeiro).
    const eligible = stats
      .filter((s) => s.sampleSize >= minSamples)
      .filter((s) => s.conversionRate < LOW_CONVERSION_THRESHOLD)
      .sort((a, b) => a.conversionRate - b.conversionRate);

    for (const cohort of eligible) {
      const candidate = this.buildCandidate(cohort, rules);
      if (!candidate) continue;

      // ADI-F2-02: dupla barreira — valida antes de propor.
      if (!this.validateCandidate(candidate.rule, rules)) continue;

      // ADI-F2-06: dedup por fingerprint.
      if (this.seenFingerprints.has(candidate.fingerprint)) continue;

      this.seenFingerprints.add(candidate.fingerprint);
      return candidate;
    }

    return null;
  }

  private buildCandidate(
    cohort: CohortStats,
    rules: MerchantRules
  ): DiscountRuleCandidate | null {
    const cap = rules.maxDiscountPercent;
    if (cap <= 0) return null;

    // ADI-F2-02 (barreira de margem): o desconto candidato é sempre capado em
    // reais, amortecendo o impacto na margem. Ainda assim, se a margem média da
    // cohort estiver abaixo do mínimo além do buffer de segurança, nenhuma
    // candidata é segura — nunca gerar algo que daria prejuízo.
    if (rules.minimumMarginPercent - cohort.avgMarginPercent > MARGIN_SAFETY_BUFFER) {
      return null;
    }

    // price_sensitive: mira o topo do range (mais sensível a preço).
    // Demais intents: proposta mais conservadora (metade do range).
    const percent =
      cohort.intent === "price_sensitive"
        ? cap
        : Math.max(1, Math.floor(cap / 2));

    // maxDiscountReais derivado do carrinho de referência (GA-01, reais float).
    const maxDiscountReais = Number(
      ((REFERENCE_CART_VALUE * percent) / 100).toFixed(2)
    );

    const conditions: RuleCondition[] = [
      { field: "buyer_type", operator: "is", value: cohort.intent },
    ];

    const fingerprint = this.computeFingerprint(
      cohort.intent,
      percent,
      maxDiscountReais
    );

    const rule: AdvancedRule = {
      id: fingerprint,
      name: `Auto: ${cohort.intent} conversion boost`,
      conditions,
      action: {
        type: "offer_discount",
        params: { percent, maxDiscountReais },
      },
      enabled: false,
      priority: 100,
    };

    const projectedLiftPercent = Number(
      ((LOW_CONVERSION_THRESHOLD - cohort.conversionRate) * 100).toFixed(2)
    );

    return {
      rule,
      rationale: `Cohort "${cohort.intent}" converte a ${(
        cohort.conversionRate * 100
      ).toFixed(1)}% (N=${cohort.sampleSize}); desconto ${percent}% (cap R$${maxDiscountReais.toFixed(
        2
      )}) para elevar conversão dentro dos limites de margem.`,
      projectedLiftPercent,
      fingerprint,
    };
  }

  /**
   * ADI-F2-02: rejeita candidata insegura.
   * - percent > maxDiscountPercent → rejeita (nunca excede o cap).
   * - percent <= 0 → rejeita.
   * - maxDiscountReais < 0 → rejeita.
   * - margem projetada abaixo do mínimo (além do buffer de segurança) → rejeita.
   */
  private validateCandidate(
    candidate: AdvancedRule,
    rules: MerchantRules
  ): boolean {
    const percent = Number(candidate.action.params.percent);
    if (!Number.isFinite(percent) || percent <= 0) return false;
    if (percent > rules.maxDiscountPercent) return false;

    const maxReais = candidate.action.params.maxDiscountReais;
    if (maxReais !== undefined) {
      const reais = Number(maxReais);
      if (!Number.isFinite(reais) || reais < 0) return false;
    }

    return true;
  }

  private computeFingerprint(
    intent: string,
    percent: number,
    maxDiscountReais: number
  ): string {
    return createHash("sha256")
      .update(`discount_rule|${intent}|${percent}|${maxDiscountReais}`)
      .digest("hex");
  }
}
