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
  scopeRulesToProduct,
  mergeProductRules,
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

  async execute(input: UpsertProductAdvancedRulesInput): Promise<AdvancedRule[]> {
    const { merchantId, productId, rules } = input;

    // Never trust a client-supplied SKU list. Resolve the route product inside
    // the merchant boundary so a product promotion cannot target another SKU.
    const product = await this.productRepo.findById(merchantId, productId);
    if (!product) throw new NotFoundException("product_not_found");
    const productSkus = product.variants.filter((variant) => variant.isActive).map((variant) => variant.sku);
    if (productSkus.length === 0) {
      throw new ConflictException("product_advanced_rules_require_active_variant");
    }

    // 1. Auto-scope incoming rules to this product's SKUs.
    const scoped = scopeRulesToProduct(rules, productSkus);

    // 2. Read merchant's current advancedRules (default if absent), merchant-scoped.
    const current: CheckoutSettings =
      (await this.checkoutSettingsRepo.get(merchantId)) ??
      CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
    const existing = current.advancedRules as unknown as AdvancedRule[];

    // 3. Merge: replace by id, append new, preserve unrelated.
    const merged = mergeProductRules(existing, scoped);

    // 4. Persist merged rules back, scoped to merchant.
    const validated = CheckoutSettingsEntity.rehydrate(current)
      .update({ advancedRules: merged as unknown as CheckoutSettings["advancedRules"] })
      .snapshot();
    await this.checkoutSettingsRepo.save(validated, current.updatedAt);

    // 5. Return merged rules for confirmation.
    return merged;
  }
}
