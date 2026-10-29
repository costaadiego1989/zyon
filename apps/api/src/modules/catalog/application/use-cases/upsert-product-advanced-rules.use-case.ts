import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CheckoutSettings } from "@zyon/shared-types";
import type { AdvancedRule } from "../../../checkout/domain/services/advanced-rule-evaluator.service.js";
import {
  CHECKOUT_SETTINGS_REPOSITORY,
  type CheckoutSettingsRepository,
} from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";
import type { ProductRepositoryPort } from "../../domain/ports/product-repository.port.js";
import {
  isRuleForProduct,
  replaceProductRules,
} from "../../domain/services/product-rule-scoping.service.js";

export interface UpsertProductAdvancedRulesInput {
  merchantId: string;
  productId: string;
  rules: AdvancedRule[];
}

@Injectable()
export class UpsertProductAdvancedRulesUseCase {
  constructor(
    @Inject(CHECKOUT_SETTINGS_REPOSITORY)
    private readonly checkoutSettingsRepo: CheckoutSettingsRepository,
    @Inject("ProductRepositoryPort")
    private readonly productRepo: ProductRepositoryPort,
  ) {}

  private editableRules(rules: AdvancedRule[], productId: string, skus: string[]): AdvancedRule[] {
    return rules.filter((rule) => isRuleForProduct(rule, productId, skus)).map((rule) => {
      // Strip only one matching automatic scope, even if the global editor reordered conditions.
      const conditions = [...rule.conditions];
      const scopeIndex = conditions.map((c) => c.field === "product_in_cart" && c.operator === "contains" &&
        (Array.isArray(c.value) ? c.value : [String(c.value)]).length > 0 &&
        (Array.isArray(c.value) ? c.value : [String(c.value)]).every((sku) => skus.includes(sku))).lastIndexOf(true);
      if (scopeIndex >= 0) conditions.splice(scopeIndex, 1);
      return { ...rule, conditions };
    });
  }

  async get(merchantId: string, productId: string): Promise<AdvancedRule[]> {
    const product = await this.productRepo.findById(merchantId, productId);
    if (!product) throw new NotFoundException("product_not_found");
    const settings = await this.checkoutSettingsRepo.get(merchantId);
    return this.editableRules((settings?.advancedRules ?? []) as AdvancedRule[], productId, product.variants.map((v) => v.sku));
  }

  async execute(input: UpsertProductAdvancedRulesInput): Promise<AdvancedRule[]> {
    const { merchantId, productId, rules } = input;

    // Never trust a client-supplied SKU list. Resolve the route product inside
    // the merchant boundary so a product promotion cannot target another SKU.
    const product = await this.productRepo.findById(merchantId, productId);
    if (!product) throw new NotFoundException("product_not_found");
    const productSkus = product.variants.filter((variant) => variant.isActive).map((variant) => variant.sku);
    if (productSkus.length === 0 && rules.length > 0) {
      throw new ConflictException("product_advanced_rules_require_active_variant");
    }
    // 2. Read merchant's current advancedRules (default if absent), merchant-scoped.
    const current: CheckoutSettings =
      (await this.checkoutSettingsRepo.get(merchantId)) ??
      CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
    const existing = current.advancedRules as unknown as AdvancedRule[];

    // 3. Merge: replace by id, append new, preserve unrelated.
    let merged: AdvancedRule[];
    try {
      merged = replaceProductRules(existing, rules, productId, productSkus);
    } catch {
      throw new ConflictException("product_rule_id_conflict");
    }

    // 4. Persist merged rules back, scoped to merchant.
    const validated = CheckoutSettingsEntity.rehydrate(current)
      .update({ advancedRules: merged as unknown as CheckoutSettings["advancedRules"] })
      .snapshot();
    const persisted = await this.checkoutSettingsRepo.save(validated, current.updatedAt);

    // 5. Return the repository result, so callers receive the exact conditions
    // and product scope that were persisted (rather than the pre-save merge).
    return persisted.advancedRules as unknown as AdvancedRule[];
  }
}
